import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { toJSONAsync } from "seroval";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";

const local = localSupabase();
const password = `Delete!${randomUUID()}`;
let users: { id: string; email: string; name: string }[];

test.beforeEach(async () => {
  users = [];
  for (const role of ["admin", "trainee", "other admin"]) {
    const email = `${randomUUID()}@ojt.local.test`;
    const name = `Deletion ${role} ${randomUUID().slice(0, 8)}`;
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
        .update({ is_admin: role !== "trainee" })
        .eq("id", user.id),
    );
  }
});

test.afterEach(async () => {
  for (const user of users) {
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", user.id));
    const profile = checked(await local.admin.from("profiles").select("id").eq("id", user.id));
    if (profile.length) checked(await local.admin.auth.admin.deleteUser(user.id));
  }
});

async function openDeletion(page: Page) {
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByLabel("Email", { exact: true }).fill(users[0].email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(users[1].name) }).click();
  await page.getByRole("button", { name: "Delete unused account", exact: true }).click();
  return (await page
    .locator("[data-admin-delete-account-endpoint]")
    .getAttribute("data-admin-delete-account-endpoint"))!;
}

test("typed confirmation and cancel protect an unused account; confirmed deletion removes it", async ({
  page,
}) => {
  await openDeletion(page);
  const confirm = page.getByRole("button", { name: "Permanently delete account", exact: true });
  await expect(confirm).toBeDisabled();
  await expect(page.getByRole("alertdialog")).toContainText(users[1].id);
  await page.getByLabel("Type the account ID to confirm").fill(randomUUID());
  await expect(confirm).toBeDisabled();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  expect(
    checked(await local.admin.from("profiles").select("id").eq("id", users[1].id)),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "Delete unused account", exact: true }).click();
  await expect(page.getByLabel("Type the account ID to confirm")).toHaveValue("");
  await page.getByLabel("Type the account ID to confirm").fill(users[1].id);
  await confirm.click();
  await expect(page.getByRole("status")).toContainText("Permanently deleted");
  await expect(page.getByRole("button", { name: new RegExp(users[1].name) })).toHaveCount(0);
  expect(
    checked(await local.admin.from("profiles").select("id").eq("id", users[1].id)),
  ).toHaveLength(0);
  await page.getByRole("button", { name: new RegExp(users[0].name) }).click();
  await expect(
    page.getByRole("button", { name: "Delete unused account", exact: true }),
  ).toBeDisabled();
});

test("server rejects forged callers, inactive admins, protected accounts and DTR history", async ({
  page,
}) => {
  const endpoint = await openDeletion(page);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  const sessions = [];
  for (const user of users.slice(0, 2)) {
    const client = local.client();
    const { session } = checked(
      await client.auth.signInWithPassword({ email: user.email, password }),
    );
    sessions.push({ client, token: session.access_token });
  }
  const probe = async (token: string | null, target = users[1].id, confirmation = target) => {
    const body = JSON.stringify(
      await toJSONAsync({
        data: {
          targetUserId: target,
          confirmation,
          actor_user_id: users[0].id,
        },
      }),
    );
    return page.evaluate(
      async ({ endpoint, token, body }) => {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "content-type": "application/json",
            accept: "application/json",
            "x-tsr-serverFn": "true",
          },
          body,
        });
        return response.text();
      },
      { endpoint, token, body },
    );
  };
  try {
    expect(await probe(null)).toMatch(/Unauthorized/i);
    expect(await probe(sessions[1].token)).toMatch(/Only active DTR administrators/);
    checked(await local.admin.from("profiles").update({ is_active: false }).eq("id", users[0].id));
    expect(await probe(sessions[0].token)).toMatch(/Only active DTR administrators/);
    checked(await local.admin.from("profiles").update({ is_active: true }).eq("id", users[0].id));
    expect(await probe(sessions[0].token, users[0].id)).toMatch(/own account/);
    expect(await probe(sessions[0].token, users[2].id)).toMatch(/Administrator accounts/);
    expect(await probe(sessions[0].token, users[1].id, randomUUID())).toMatch(/exact account ID/);
    checked(
      await local.admin
        .from("dtr_entries")
        .insert({ user_id: users[1].id, entry_date: "2000-01-01" }),
    );
    expect(await probe(sessions[0].token)).toMatch(/DTR history/);
    expect(
      checked(
        await local.admin
          .from("profiles")
          .select("id")
          .in(
            "id",
            users.map((user) => user.id),
          ),
      ),
    ).toHaveLength(3);
  } finally {
    for (const session of sessions) await session.client.auth.signOut();
  }
});

test("new attendance while confirmation is open blocks deletion and refreshes the DTR", async ({
  page,
}) => {
  await openDeletion(page);
  checked(
    await local.admin
      .from("dtr_entries")
      .insert({ user_id: users[1].id, entry_date: "2000-01-01" }),
  );
  await page.getByLabel("Type the account ID to confirm").fill(users[1].id);
  await page.getByRole("button", { name: "Permanently delete account", exact: true }).click();
  await expect(page.getByRole("alertdialog").getByRole("alert")).toContainText("DTR history");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Delete unused account", exact: true }),
  ).toBeDisabled();
  expect(
    checked(await local.admin.from("dtr_entries").select("id").eq("user_id", users[1].id)),
  ).toHaveLength(1);
});

test("a lost deletion response reconciles the account list without claiming a rollback", async ({
  page,
}) => {
  const endpoint = await openDeletion(page);
  await page.route(`**${new URL(endpoint, "http://localhost:3000").pathname}*`, async (route) => {
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByLabel("Type the account ID to confirm").fill(users[1].id);
  await page.getByRole("button", { name: "Permanently delete account", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("refreshed account list no longer contains");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: new RegExp(users[1].name) })).toHaveCount(0);
  expect(
    checked(await local.admin.from("profiles").select("id").eq("id", users[1].id)),
  ).toHaveLength(0);
});
