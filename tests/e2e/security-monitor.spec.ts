import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";
const local = localSupabase();
const password = `Guard!${randomUUID()}`;
let guardId: string;
let personId: string;
test.beforeAll(async () => {
  guardId = checked(
    await local.admin.auth.admin.createUser({
      email: "psasecurity@security.psa-dtr.invalid",
      password,
      email_confirm: true,
      app_metadata: { dtr_access_role: "security_monitor" },
    }),
  ).user.id;
  personId = checked(
    await local.admin.auth.admin.createUser({
      email: `${randomUUID()}@example.test`,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: "Security browser fixture",
        student_id: "T",
        company: "PSA",
        ojt_title: "Intern",
      },
    }),
  ).user.id;
  checked(
    await local.admin.from("dtr_entries").insert({
      user_id: personId,
      entry_date: "2020-01-01",
      check_in: "2020-01-01T08:00:00+08:00",
      check_out: "2020-01-01T17:00:00+08:00",
    }),
  );
});
test.afterAll(async () => {
  const sql = postgres(local.databaseUrl);
  if (guardId) {
    await sql`delete from dtr_private.security_monitors where user_id=${guardId}`;
    checked(await local.admin.auth.admin.deleteUser(guardId));
  }
  if (personId) {
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", personId));
    checked(await local.admin.auth.admin.deleteUser(personId));
  }
  await sql.end();
});
test("username login, historical filtering, mobile layout and password change", async ({
  page,
}) => {
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByLabel("Email or username", { exact: true }).fill("psasecurity");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Attendance log", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Check in", exact: true })).toHaveCount(0);
  await page.getByLabel("Attendance date", { exact: true }).fill("2020-01-01");
  await expect(page.getByText("Security browser fixture", { exact: true })).toBeVisible();
  await page.getByLabel("Search name").fill("no matching person");
  await expect(page.getByText("No records match your filters.")).toBeVisible();
  await page.getByLabel("Search name").fill("");
  await page.getByLabel("Account type", { exact: true }).selectOption("processing");
  await expect(page.getByText("No records match your filters.")).toBeVisible();
  await page.getByLabel("Account type", { exact: true }).selectOption("ojt");
  await expect(page.getByText("Security browser fixture", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/security-monitor-mobile.png", fullPage: true });
  await page.getByRole("link", { name: "Change password" }).click();
  await expect(page.getByRole("link", { name: "Back to dashboard" })).toBeVisible();
  const next = `NewGuard!${randomUUID()}`;
  await page.getByLabel("New password", { exact: true }).fill(next);
  await page.getByLabel("Confirm new password", { exact: true }).fill(next);
  await page.getByRole("button", { name: "Update password", exact: true }).click();
  await expect(page.getByText("Your password has been updated.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Continue to your dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Attendance log", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const client = local.client();
  checked(
    await client.auth.signInWithPassword({
      email: "psasecurity@security.psa-dtr.invalid",
      password: next,
    }),
  );
  await client.auth.signOut();
});
