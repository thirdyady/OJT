import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";

const local = localSupabase();
const password = `Final!${randomUUID()}`;
let users: { id: string; email: string; name: string }[];

test.beforeEach(async () => {
  users = [];
  for (const role of ["trainee", "admin"]) {
    const email = `${randomUUID()}@ojt.local.test`;
    const name = `Final ${role} ${randomUUID().slice(0, 8)}`;
    const { user } = checked(
      await local.admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: name,
          student_id: name,
          company: "Original company",
          ojt_title: "Intern",
        },
      }),
    );
    users.push({ id: user.id, email, name });
    checked(
      await local.admin
        .from("profiles")
        .update({ is_admin: role === "admin", required_ojt_hours: 10000 })
        .eq("id", user.id),
    );
  }
});

test.afterEach(async () => {
  for (const user of users) {
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", user.id));
    checked(await local.admin.auth.admin.deleteUser(user.id));
  }
});

async function login(page: Page, index = 0) {
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByLabel("Email", { exact: true }).fill(users[index].email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}

test("all 1001 attendance rows contribute to progress and historical reports", async ({ page }) => {
  const records = Array.from({ length: 1001 }, (_, index) => {
    const date = new Date(Date.UTC(2000, 0, index + 1)).toISOString().slice(0, 10);
    return {
      user_id: users[0].id,
      entry_date: date,
      check_in: `${date}T08:00:00+08:00`,
      check_out: `${date}T16:00:00+08:00`,
    };
  });
  checked(await local.admin.from("dtr_entries").insert(records));
  await login(page);
  await expect(page.getByRole("progressbar", { name: "OJT completion" })).toHaveAttribute(
    "aria-valuenow",
    "80.08",
  );
  await page.getByLabel("Select month to view/download").selectOption("0");
  await page.getByLabel("Select year to view/download").selectOption("2000");
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const csv = await readFile((await (await downloadEvent).path())!, "utf8");
  expect(csv.trim().split("\n")).toHaveLength(32);
  expect(csv).toContain("2000-01-01");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, 1);
  await page.getByRole("button", { name: new RegExp(users[0].name) }).click();
  await page.getByLabel("Select month to view/print/download").selectOption("0");
  await page.getByLabel("Select year to view/print/download").selectOption("2000");
  await expect(page.getByText(/Total: 248\.00 hrs across 31 days/)).toBeVisible();
});

test("stale admin and trainee profile saves preserve the newer company", async ({ page }) => {
  await login(page, 1);
  await page.getByRole("button", { name: new RegExp(users[0].name) }).click();
  await page.getByLabel("Full Name", { exact: true }).fill("Corrected name");
  checked(
    await local.admin.from("profiles").update({ company: "New company" }).eq("id", users[0].id),
  );
  await page.getByRole("button", { name: "Save trainee profile", exact: true }).click();
  await expect(page.getByText(/This profile changed/)).toBeVisible();
  expect(
    checked(await local.admin.from("profiles").select("company").eq("id", users[0].id).single())
      .company,
  ).toBe("New company");
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page);
  await page.getByLabel("Full Name", { exact: true }).fill("Trainee edit");
  checked(
    await local.admin.from("profiles").update({ company: "Newest company" }).eq("id", users[0].id),
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("profile changed");
  expect(
    checked(await local.admin.from("profiles").select("company").eq("id", users[0].id).single())
      .company,
  ).toBe("Newest company");
});

test("account listing continues when the API returns fewer rows than the requested page size", async ({
  page,
}) => {
  const base = checked(await local.admin.from("profiles").select().eq("id", users[0].id).single());
  const profiles = Array.from({ length: 5 }, (_, index) => ({
    ...base,
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    full_name: `Paginated account ${index + 1}`,
  }));
  const cursors = new Set<string>();
  await page.route("**/rest/v1/profiles?*", async (route) => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("limit")) return route.continue();
    const after = url.searchParams.get("id")?.replace(/^gt\./, "") ?? "";
    cursors.add(after);
    await route.fulfill({ json: profiles.filter((profile) => profile.id > after).slice(0, 2) });
  });
  await login(page, 1);
  await expect(page.getByRole("button", { name: /Paginated account 5/ })).toBeVisible();
  // Development StrictMode may replay the load; verify all cursor boundaries.
  expect(cursors).toEqual(new Set(["", profiles[1].id, profiles[3].id, profiles[4].id]));
});

test("UTC devices display Manila punches and use the Manila attendance date", async ({
  browser,
}) => {
  const context = await browser.newContext({ timezoneId: "UTC" });
  const page = await context.newPage();
  try {
    checked(
      await local.admin.from("dtr_entries").insert({
        user_id: users[0].id,
        entry_date: "2000-01-03",
        check_in: "2000-01-03T08:00:00+08:00",
        check_out: "2000-01-03T16:00:00+08:00",
      }),
    );
    await login(page);
    await page.getByRole("button", { name: "Check In now", exact: true }).click();
    await expect(page.getByRole("button", { name: "Break Out now", exact: true })).toBeVisible();
    const records = checked(
      await local.admin
        .from("dtr_entries")
        .select("entry_date,check_in")
        .eq("user_id", users[0].id)
        .neq("entry_date", "2000-01-03"),
    );
    expect(records).toHaveLength(1);
    const manilaDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(records[0].check_in));
    expect(records[0].entry_date).toBe(manilaDate);
    await page.getByLabel("Select month to view/download").selectOption("0");
    await page.getByLabel("Select year to view/download").selectOption("2000");
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV", exact: true }).click();
    const csv = await readFile((await (await downloadEvent).path())!, "utf8");
    expect(csv).toMatch(/08:00/);
    expect(csv).toMatch(/04:00|16:00/);
  } finally {
    await context.close();
  }
});

test("whitespace-only required signup fields are rejected before contacting Auth", async ({
  page,
}) => {
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  for (const label of ["Full name", "Student ID", "Host company", "OJT title"])
    await page.getByLabel(label, { exact: true }).fill("   ");
  await page.getByLabel("Email", { exact: true }).fill(`${randomUUID()}@ojt.local.test`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  let requests = 0;
  page.on("request", (request) => {
    if (request.url().includes("/auth/v1/signup")) requests++;
  });
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Spaces alone are not valid");
  expect(requests).toBe(0);
});
