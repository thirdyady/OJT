import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";
import { setupChief, chiefPassword, recoveryCode } from "../chief-fixture.mjs";
const local = localSupabase();
let actor: { id: string; email: string; password: string };
test.beforeEach(async ({ page }) => {
  await setupChief(true);
  const email = `${randomUUID()}@ojt.local.test`,
    password = `Login!${randomUUID()}`;
  const { user } = checked(
    await local.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: "Chief Settings Admin",
        student_id: randomUUID(),
        company: "PSA",
        ojt_title: "Admin",
      },
    }),
  );
  actor = { id: user.id, email, password };
  checked(await local.admin.from("profiles").update({ is_admin: true }).eq("id", actor.id));
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByLabel(/^Email(?: or username)?$/).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Forgot Approval Password", exact: true }),
  ).toBeVisible();
});
test.afterEach(async () => {
  if (actor) checked(await local.admin.auth.admin.deleteUser(actor.id));
  await setupChief(true);
});
test("Chief can rotate the password; invalid current password clears all fields; show/hide and cancel are safe", async ({
  page,
}) => {
  const next = `NewChief!${randomUUID()}`;
  const settings = page.getByRole("region", { name: "Chief approval settings", exact: true });
  await settings.screenshot({ path: test.info().outputPath("chief-settings-desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await settings.screenshot({ path: test.info().outputPath("chief-settings-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "Change Password", exact: true }).click();
  const current = page.getByLabel("Chief Approval Password", { exact: true });
  await current.fill("incorrect");
  const hiddenToggle = page.getByRole("button", { name: "Show password", exact: true });
  await expect(hiddenToggle).toHaveAttribute("aria-pressed", "false");
  const hiddenBackground = await hiddenToggle.evaluate(
    (button) => getComputedStyle(button).backgroundColor,
  );
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(current).toHaveAttribute("type", "text");
  const visibleToggle = page.getByRole("button", { name: "Hide password", exact: true });
  await expect(visibleToggle).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("Visibility on — the approval credential is visible.")).toBeVisible();
  await expect
    .poll(() => visibleToggle.evaluate((button) => getComputedStyle(button).backgroundColor))
    .not.toBe(hiddenBackground);
  await page
    .getByRole("alertdialog")
    .screenshot({ path: test.info().outputPath("password-visible.png") });
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
  await expect(current).toHaveAttribute("type", "password");
  await expect(hiddenToggle).toHaveAttribute("aria-pressed", "false");
  await page.getByLabel("New Chief Approval Password", { exact: true }).fill(next);
  await page.getByLabel("Confirm New Password", { exact: true }).fill(next);
  await page.getByRole("button", { name: "Approve and Save", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("not accepted");
  for (const label of [
    "Chief Approval Password",
    "New Chief Approval Password",
    "Confirm New Password",
  ])
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("");
  await current.fill(chiefPassword);
  await page.getByLabel("New Chief Approval Password", { exact: true }).fill(next);
  await page.getByLabel("Confirm New Password", { exact: true }).fill(next);
  await page.getByRole("button", { name: "Approve and Save", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("updated");
  const audits = checked(
    await local.admin.from("dtr_admin_audit").select().eq("actor_id", actor.id),
  );
  expect(audits).toHaveLength(1);
  expect(audits[0].action).toBe("chief_ssp_changed");
  await page.getByRole("button", { name: "Change Password", exact: true }).click();
  await current.fill(next);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Change Password", exact: true }).click();
  await expect(current).toHaveValue("");
  const storage = await page.evaluate(() =>
    JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]),
  );
  expect(storage).not.toContain(next);
  expect(storage).not.toContain(chiefPassword);
});
test("recovery requires the separate code and displays its replacement only once", async ({
  page,
}) => {
  const next = `Recovered!${randomUUID()}`;
  await page.getByRole("button", { name: "Forgot Approval Password", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve and Save", exact: true })).toBeDisabled();
  await page.getByLabel("Recovery code", { exact: true }).fill(recoveryCode);
  await page.getByLabel("New Chief Approval Password", { exact: true }).fill(next);
  await page.getByLabel("Confirm New Password", { exact: true }).fill(next);
  await page.getByRole("button", { name: "Approve and Save", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  const displayed = page.locator("code");
  await expect(displayed).toHaveText(/^[A-HJKMNP-Z]{4}-[A-HJKMNP-Z]{4}-[A-HJKMNP-Z]{4}$/);
  const replacement = await displayed.textContent();
  expect(replacement).not.toBe(recoveryCode);
  await page.getByRole("tab", { name: "Reports", exact: true }).click();
  await expect(displayed).toBeHidden();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await expect(displayed).toHaveText(replacement!);
  await page.getByRole("button", { name: "I have stored the code", exact: true }).click();
  await expect(displayed).toHaveCount(0);
  await page.reload();
  await page.getByRole("tab", { name: "Settings", exact: true }).click();
  await expect(page.locator("code")).toHaveCount(0);
  const audits = checked(
    await local.admin.from("dtr_admin_audit").select().eq("actor_id", actor.id),
  );
  expect(audits).toHaveLength(1);
  expect(audits[0].action).toBe("chief_ssp_recovered");
  expect(JSON.stringify(audits)).not.toContain(replacement);
  await page.getByRole("button", { name: "Forgot Approval Password", exact: true }).click();
  await expect(page.getByText(/New codes contain 12 letters/)).toBeVisible();
  await page
    .getByLabel("Recovery code", { exact: true })
    .fill(replacement!.replaceAll("-", "").toLowerCase());
  const finalPassword = `RecoveredAgain!${randomUUID()}`;
  await page.getByLabel("New Chief Approval Password", { exact: true }).fill(finalPassword);
  await page.getByLabel("Confirm New Password", { exact: true }).fill(finalPassword);
  await page.getByRole("button", { name: "Approve and Save", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.locator("code")).toHaveText(
    /^[A-HJKMNP-Z]{4}-[A-HJKMNP-Z]{4}-[A-HJKMNP-Z]{4}$/,
  );
  await expect(page.locator("code")).not.toHaveText(replacement!);
});
