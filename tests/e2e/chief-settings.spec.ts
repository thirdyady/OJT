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
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
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
  await page.getByRole("button", { name: "Change Password", exact: true }).click();
  const current = page.getByLabel("Chief Approval Password", { exact: true });
  await current.fill("incorrect");
  await page.getByRole("button", { name: "Show password", exact: true }).click();
  await expect(current).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide password", exact: true }).click();
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
  await expect(displayed).toHaveText(/^[0-9a-f]{48}$/);
  const replacement = await displayed.textContent();
  expect(replacement).not.toBe(recoveryCode);
  await page.getByRole("button", { name: "I have stored the code", exact: true }).click();
  await expect(displayed).toHaveCount(0);
  await page.reload();
  await expect(page.locator("code")).toHaveCount(0);
  const audits = checked(
    await local.admin.from("dtr_admin_audit").select().eq("actor_id", actor.id),
  );
  expect(audits).toHaveLength(1);
  expect(audits[0].action).toBe("chief_ssp_recovered");
  expect(JSON.stringify(audits)).not.toContain(replacement);
});
