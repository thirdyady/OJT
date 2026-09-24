import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { toJSONAsync } from "seroval";
import postgres from "postgres";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";
import { setupChief, chiefPassword, approvePopup, saveCorrection } from "../chief-fixture.mjs";
const local = localSupabase();
const password = `Delete!${randomUUID()}`;
let users: { id: string; email: string; name: string }[];
test.beforeEach(async () => {
  await setupChief();
  users = [];
  for (const role of ["admin", "employee", "other admin"]) {
    const email = `${randomUUID()}@ojt.local.test`,
      name = `Chief ${role} ${randomUUID().slice(0, 8)}`;
    const { user } = checked(
      await local.admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name, student_id: name, company: "PSA", ojt_title: "Intern" },
      }),
    );
    users.push({ id: user.id, email, name });
    checked(
      await local.admin
        .from("profiles")
        .update({ is_admin: role !== "employee" })
        .eq("id", user.id),
    );
  }
});
test.afterEach(async () => {
  for (const user of users) {
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", user.id));
    if (checked(await local.admin.from("profiles").select("id").eq("id", user.id)).length)
      checked(await local.admin.auth.admin.deleteUser(user.id));
  }
});
async function login(page: Page) {
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByLabel("Email", { exact: true }).fill(users[0].email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(users[1].name) }).click();
}
async function openDeletion(page: Page) {
  await login(page);
  await page.getByRole("button", { name: "Delete unused account", exact: true }).click();
  await page.getByLabel("Type the account ID to confirm").fill(users[1].id);
  await page.getByRole("button", { name: "Permanently delete account", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Approval Needed" })).toBeVisible();
  await expect(page.getByText(users[1].email, { exact: true })).toBeVisible();
}

test("deletion requires Chief SSP; cancel and wrong credentials preserve account; successful deletion audits once", async ({
  page,
}) => {
  await openDeletion(page);
  await approvePopup(page, "incorrect");
  await expect(page.getByRole("alert")).toContainText("not accepted");
  await expect(page.getByLabel("Chief Approval Password", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  expect(
    checked(await local.admin.from("profiles").select("id").eq("id", users[1].id)),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Delete unused account", exact: true }).click();
  await page.getByLabel("Type the account ID to confirm").fill(users[1].id);
  await page.getByRole("button", { name: "Permanently delete account", exact: true }).click();
  await approvePopup(page);
  await expect(page.getByRole("status")).toContainText("permanently deleted");
  const events = checked(
    await local.admin.from("dtr_admin_audit").select().eq("affected_user", users[1].id),
  );
  expect(events).toHaveLength(1);
  expect(events[0].old_values.email).toBe(users[1].email);
  expect(events[0].approval_method).toBe("chief_ssp");
});
test("history created while approval is open blocks deletion even with correct SSP", async ({
  page,
}) => {
  await openDeletion(page);
  checked(
    await local.admin
      .from("dtr_entries")
      .insert({ user_id: users[1].id, entry_date: "2000-01-01" }),
  );
  await approvePopup(page);
  await expect(page.getByRole("alert")).toContainText("historical");
  expect(
    checked(await local.admin.from("profiles").select("id").eq("id", users[1].id)),
  ).toHaveLength(1);
});
test("lost approval response can be retried without duplicate deletion or audit", async ({
  page,
}) => {
  await openDeletion(page);
  const endpoint = (await page
    .locator("[data-chief-approve-endpoint]")
    .getAttribute("data-chief-approve-endpoint"))!;
  const pattern = `**${new URL(endpoint, "http://localhost:3000").pathname}*`;
  await page.route(pattern, async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await approvePopup(page);
  await expect(page.getByRole("alert")).toContainText("response was not confirmed");
  await page.unroute(pattern);
  await approvePopup(page);
  await expect(page.getByRole("status")).toContainText("permanently deleted");
  expect(
    checked(await local.admin.from("dtr_admin_audit").select().eq("affected_user", users[1].id)),
  ).toHaveLength(1);
});
test("trusted endpoint rejects anonymous, ordinary and inactive callers and injected actor identity", async ({
  page,
}) => {
  await openDeletion(page);
  const endpoint = (await page
    .locator("[data-chief-prepare-endpoint]")
    .getAttribute("data-chief-prepare-endpoint"))!;
  const clients = [];
  for (const user of users.slice(0, 2)) {
    const client = local.client();
    const { session } = checked(
      await client.auth.signInWithPassword({ email: user.email, password }),
    );
    clients.push({ client, token: session.access_token });
  }
  const probe = async (token: string | null, extra = {}) => {
    const body = JSON.stringify(
      await toJSONAsync({
        data: {
          requestId: randomUUID(),
          operation: "delete_account",
          payload: { targetUserId: users[1].id, confirmation: users[1].id },
          ...extra,
        },
      }),
    );
    return page.evaluate(
      async ({ endpoint, token, body }) =>
        (
          await fetch(endpoint, {
            method: "POST",
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              "content-type": "application/json",
              accept: "application/json",
              "x-tsr-serverFn": "true",
            },
            body,
          })
        ).text(),
      { endpoint, token, body },
    );
  };
  try {
    expect(await probe(null)).toMatch(/Unauthorized/);
    expect(await probe(clients[1].token)).toMatch(/administrator/);
    expect(await probe(clients[0].token, { actor_user_id: users[2].id })).toMatch(
      /unrecognized|Unrecognized/,
    );
    checked(await local.admin.from("profiles").update({ is_active: false }).eq("id", users[0].id));
    expect(await probe(clients[0].token)).toMatch(/administrator/);
  } finally {
    for (const c of clients) await c.client.auth.signOut();
  }
});
test("DTR review requires reason, cancel saves nothing, expired approval fails, valid edit creates audit", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Edit DTR", exact: true }).click();
  await page.getByLabel("Attendance date", { exact: true }).fill("2000-01-01");
  await page.getByLabel("Check In", { exact: true }).fill("08:00:00");
  await page.getByLabel("Check Out", { exact: true }).fill("17:00:00");
  await expect(page.getByRole("button", { name: "Save Changes" })).toBeDisabled();
  await page.getByLabel("Correction reason").fill("Approved missing attendance");
  await page.getByRole("button", { name: "Save Changes" }).click();
  expect(
    checked(await local.admin.from("dtr_entries").select().eq("user_id", users[1].id)),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Save Changes" }).click();
  await expect(page.getByRole("button", { name: "Approve and Save" })).toBeVisible();
  await expect(page.getByText("Checking approval request…", { exact: true })).toHaveCount(0);
  const sql = postgres(local.databaseUrl, { max: 1 });
  try {
    await sql`UPDATE dtr_private.chief_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE actor_id=${users[0].id}`;
  } finally {
    await sql.end();
  }
  await approvePopup(page);
  await expect(page.getByRole("alert")).toContainText("expired");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await saveCorrection(page);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(
    checked(await local.admin.from("dtr_entries").select().eq("user_id", users[1].id)),
  ).toHaveLength(1);
  expect(
    checked(await local.admin.from("dtr_admin_audit").select().eq("affected_user", users[1].id)),
  ).toHaveLength(1);
});
test("invalid DTR edits remain unsaved and repeated approval clicks create one correction", async ({
  page,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Edit DTR", exact: true }).click();
  await page.getByLabel("Attendance date", { exact: true }).fill("2000-01-01");
  await page.getByLabel("Check In", { exact: true }).fill("08:00:00");
  await page.getByLabel("Check Out", { exact: true }).fill("07:00:00");
  await saveCorrection(page);
  await expect(page.getByRole("alert")).toContainText("Invalid attendance sequence");
  expect(
    checked(await local.admin.from("dtr_entries").select().eq("user_id", users[1].id)),
  ).toHaveLength(0);
  expect(
    checked(await local.admin.from("dtr_admin_audit").select().eq("affected_user", users[1].id)),
  ).toHaveLength(0);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByLabel("Check Out", { exact: true }).fill("17:00:00");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await page.getByLabel("Chief Approval Password", { exact: true }).fill(chiefPassword);
  await page.getByRole("button", { name: "Approve and Save", exact: true }).dblclick();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(
    checked(await local.admin.from("dtr_entries").select().eq("user_id", users[1].id)),
  ).toHaveLength(1);
  expect(
    checked(await local.admin.from("dtr_admin_audit").select().eq("affected_user", users[1].id)),
  ).toHaveLength(1);
});
