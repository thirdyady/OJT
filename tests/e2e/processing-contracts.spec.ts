import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";
const local = localSupabase(),
  users: { id: string; email: string; name: string }[] = [];
const password = "Contracts!" + randomUUID();
const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const yesterday = new Date(Date.parse(today + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
const end = new Date(Date.parse(today + "T00:00:00Z") + 100 * 86400000).toISOString().slice(0, 10);
test.beforeAll(async () => {
  for (const type of ["processing", "ojt"]) {
    const email = randomUUID() + "@example.test",
      name = "Contract " + type + " " + randomUUID().slice(0, 6);
    const { user } = checked(
      await local.admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: {
          dtr_account_type: type,
          dtr_required_workdays: type === "processing" ? 20 : null,
        },
        user_metadata: { full_name: name, company: "PSA", ojt_title: "Staff", student_id: "T" },
      }),
    );
    users.push({ id: user.id, email, name });
    if (type === "ojt")
      checked(await local.admin.from("profiles").update({ is_admin: true }).eq("id", user.id));
    else {
      checked(
        await local.admin
          .from("processing_contracts")
          .update({ start_date: yesterday })
          .eq("user_id", user.id),
      );
      checked(
        await local.admin.from("dtr_entries").insert({
          user_id: user.id,
          entry_date: yesterday,
          check_in: yesterday + "T08:00:00+08:00",
          check_out: yesterday + "T16:00:00+08:00",
        }),
      );
    }
  }
});
test.afterAll(async () => {
  for (const u of users) {
    checked(await local.admin.from("processing_contract_audit").delete().eq("user_id", u.id));
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", u.id));
    checked(await local.admin.auth.admin.deleteUser(u.id));
  }
});
test("admin edits and renews; employee sees separate progress and cannot edit contracts", async ({
  page,
}) => {
  const login = async (email: string) => {
    await page.goto("/auth");
    await page.locator('body[data-app-hydrated="true"]').waitFor();
    await page.getByLabel("Email or username", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  };
  await login(users[1].email);
  await page.getByRole("button", { name: new RegExp(users[0].name) }).click();
  const panel = page.getByRole("region", { name: "Processing contracts", exact: true });
  await panel.getByRole("button", { name: "Edit contract", exact: true }).click();
  await panel.getByLabel("Required workdays", { exact: true }).fill("30");
  await panel.getByLabel("Reason for contract change").fill("Correct original target");
  await page.route(
    "**/rest/v1/rpc/dtr_save_processing_contract",
    (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ message: "Temporary failure" }),
      }),
    { times: 1 },
  );
  await panel.getByRole("button", { name: "Save contract", exact: true }).click();
  await expect(panel.getByRole("alert")).toContainText("Temporary failure");
  await expect(panel.getByLabel("Required workdays", { exact: true })).toHaveValue("30");
  await panel.getByRole("button", { name: "Save contract", exact: true }).click();
  await expect(panel.getByRole("status")).toContainText("Contract saved");
  await expect(panel).toContainText("1 / 30 completed workdays");
  await panel.getByRole("button", { name: "Renew contract", exact: true }).click();
  await panel.getByLabel("Contract start date").fill(today);
  await panel.getByLabel("Contract end date").fill(end);
  await panel.getByLabel("Required workdays", { exact: true }).fill("80");
  await panel.getByLabel("Reason for contract change").fill("New 80-day contract");
  await panel.getByRole("button", { name: "Save contract", exact: true }).click();
  await expect(panel).toContainText("0 / 80 completed workdays");
  await expect(panel).toContainText("1 / 30 completed workdays");
  await panel.getByText("Contract change history", { exact: true }).click();
  await expect(panel.getByText(/New 80-day contract/)).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(users[0].email);
  const progress = page.getByRole("region", {
    name: "Field Enumerator / Office processor progress",
    exact: true,
  });
  await expect(progress).toContainText("80 days");
  await expect(progress.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  await expect(page.getByRole("button", { name: "Renew contract", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Edit contract", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(progress.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  await page.setViewportSize({ width: 375, height: 900 });
  await expect(
    page.getByRole("region", { name: "Processing contracts", exact: true }),
  ).toContainText("1 / 30 completed workdays");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
