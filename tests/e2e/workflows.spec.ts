import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";

const local = localSupabase();
const password = `Test!${randomUUID()}`;
const email = `browser-${randomUUID()}@ojt.local.test`;
let userId: string;
let adminId: string;
const adminEmail = `admin-browser-${randomUUID()}@ojt.local.test`;

test.beforeAll(async () => {
  userId = checked(
    await local.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: "Browser Test Trainee",
        student_id: "BROWSER-ORIGINAL",
        company: "PSA (browser test)",
        ojt_title: "Browser Test Intern",
      },
    }),
  ).user.id;
  adminId = checked(
    await local.admin.auth.admin.createUser({ email: adminEmail, password, email_confirm: true }),
  ).user.id;
  checked(await local.admin.from("profiles").update({ is_admin: true }).eq("id", adminId));
  checked(await local.admin.from("profiles").update({ required_ojt_hours: 8 }).eq("id", userId));
  checked(
    await local.admin.from("dtr_entries").insert({
      user_id: userId,
      entry_date: "2000-01-03",
      check_in: "2000-01-03T08:00:00+08:00",
      break_out: "2000-01-03T12:00:00+08:00",
      break_in: "2000-01-03T13:00:00+08:00",
      check_out: "2000-01-03T17:00:00+08:00",
    }),
  );
});
test.afterAll(async () => {
  if (userId) checked(await local.admin.auth.admin.deleteUser(userId));
  if (adminId) checked(await local.admin.auth.admin.deleteUser(adminId));
});

test("attendance persists, failed writes stay unsaved, undo needs confirmation, admin can inspect and clear", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/auth$/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check In now", exact: true })).toBeVisible();
  await expect(page.getByAltText("Philippine Statistics Authority")).toBeVisible();
  await expect(page.getByRole("heading", { name: "OJT progress" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "OJT completion" })).toBeVisible();
  await expect(page.getByText("OJT target reached!")).toBeVisible();
  await page.getByLabel("Student ID", { exact: true }).fill("BROWSER-TEST");
  await page.route("**/rest/v1/profiles*", async (route) => {
    if (route.request().method() === "POST") await route.abort("failed");
    else await route.continue();
  });
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await page.unroute("**/rest/v1/profiles*");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
  const stalePage = await page.context().newPage();
  await stalePage.goto("/dashboard");
  await expect(stalePage.getByRole("button", { name: "Check In now", exact: true })).toBeVisible();
  await page.route("**/rest/v1/dtr_entries*", async (route) => {
    if (route.request().method() === "POST") await route.abort("failed");
    else await route.continue();
  });
  await page.getByRole("button", { name: "Check In now", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("not saved");
  await expect(page.getByRole("button", { name: "Check In now", exact: true })).toBeEnabled();
  await page.unroute("**/rest/v1/dtr_entries*");
  await page.getByRole("button", { name: "Check In now", exact: true }).click();
  await expect(page.getByRole("button", { name: "Break Out now", exact: true })).toBeVisible();
  await stalePage.getByRole("button", { name: "Check In now", exact: true }).click();
  await expect(stalePage.getByRole("alert")).toContainText("not saved");
  await stalePage.close();
  await page.reload();
  await expect(page.getByRole("button", { name: "Break Out now", exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Undo last" }).click();
  await expect(page.getByRole("button", { name: "Break Out now", exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Undo last" }).click();
  await expect(page.getByRole("button", { name: "Check In now", exact: true })).toBeVisible();
  for (const label of ["Check In", "Break Out", "Break In", "Check Out"]) {
    await page.getByRole("button", { name: `${label} now`, exact: true }).click();
  }
  await expect(page.getByText(/Day complete/)).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.csv$/);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "OJT Attendance · Admin" })).toBeVisible();
  await expect(page.getByAltText("Philippine Statistics Authority")).toBeVisible();
  await page.getByPlaceholder("Search name, ID, company…").fill("Browser Test Trainee");
  await page.getByRole("button", { name: /Browser Test Trainee/ }).click();
  await expect(page.getByText("OJT: Browser Test Intern")).toBeVisible();
  await expect(page.getByLabel("Required OJT hours", { exact: true })).toHaveValue("8");
  await page.getByLabel("Required OJT hours", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Save target", exact: true }).click();
  await expect(page.getByLabel("Required OJT hours", { exact: true })).toHaveValue("500");
  const clear = page.getByTitle("Clear Check Out").filter({ visible: true });
  await expect(clear).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await clear.click();
  await expect(clear).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await clear.click();
  await expect(clear).toHaveCount(0);
});

test("forgot password requests a recovery email; recovery updates the password; expired links show an error", async ({
  page,
}) => {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If an account exists/)).toBeVisible();
  const data = checked(
    await local.admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: "http://localhost:3000/reset-password" },
    }),
  );
  await page.goto(data.properties.action_link);
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  const newPassword = `Updated!${randomUUID()}`;
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password", { exact: true }).fill("different-password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("alert")).toContainText("do not match");
  await page.getByLabel("Confirm new password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("status")).toContainText("updated");
  const client = local.client();
  checked(await client.auth.signInWithPassword({ email, password: newPassword }));
  await client.auth.signOut();
  checked(await local.admin.auth.admin.updateUserById(userId, { password }));
  await page.goto("/reset-password#error=access_denied&error_description=Link+expired");
  await expect(page.getByRole("alert")).toContainText("Link expired");
  await expect(page.getByRole("button", { name: "Update password" })).toHaveCount(0);
});

test("new trainee registration requires complete profile details", async ({ page }) => {
  const signupEmail = `browser-signup-${randomUUID()}@ojt.local.test`;
  let signupUserId: string | undefined;
  try {
    await page.goto("/auth");
    await page.getByRole("button", { name: "Sign up", exact: true }).click();
    for (const label of ["Full name", "Student ID", "Host company", "OJT title"]) {
      await expect(page.getByLabel(label, { exact: true })).toHaveAttribute("required", "");
    }
    await page.getByLabel("Full name", { exact: true }).fill("Browser Signup Trainee");
    await page.getByLabel("Student ID", { exact: true }).fill("BROWSER-SIGNUP");
    await page.getByLabel("Host company", { exact: true }).fill("PSA (browser signup)");
    await page.getByLabel("OJT title", { exact: true }).fill("Statistics Intern");
    await page.getByLabel("Email", { exact: true }).fill(signupEmail);
    await page.getByLabel("Password", { exact: true }).fill(`Signup!${randomUUID()}`);
    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await expect(page.getByText(/Account created/)).toBeVisible();

    const { users } = checked(await local.admin.auth.admin.listUsers({ perPage: 1000 }));
    signupUserId = users.find((u) => u.email === signupEmail)?.id;
    expect(signupUserId).toBeTruthy();
    const profile = checked(
      await local.admin
        .from("profiles")
        .select("student_id, company, ojt_title")
        .eq("id", signupUserId!)
        .single(),
    );
    expect(profile).toEqual({
      student_id: "BROWSER-SIGNUP",
      company: "PSA (browser signup)",
      ojt_title: "Statistics Intern",
    });
  } finally {
    if (signupUserId) checked(await local.admin.auth.admin.deleteUser(signupUserId));
  }
});

test("legacy incomplete profiles can be completed without losing DTR access", async ({ page }) => {
  const legacyEmail = `browser-legacy-${randomUUID()}@ojt.local.test`;
  const legacyPassword = `Legacy!${randomUUID()}`;
  let legacyUserId: string | undefined;
  try {
    legacyUserId = checked(
      await local.admin.auth.admin.createUser({
        email: legacyEmail,
        password: legacyPassword,
        email_confirm: true,
        user_metadata: { full_name: "Legacy Incomplete Trainee" },
      }),
    ).user.id;
    await page.goto("/auth");
    await page.getByLabel("Email", { exact: true }).fill(legacyEmail);
    await page.getByLabel("Password", { exact: true }).fill(legacyPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Check In now", exact: true })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Student ID");
    await page.getByLabel("Student ID", { exact: true }).fill("LEGACY-001");
    await page.getByLabel("Host Company", { exact: true }).fill("PSA (legacy test)");
    await page.getByLabel("OJT Title", { exact: true }).fill("Legacy Data Intern");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveCount(0);
    await page.getByLabel("Required OJT hours", { exact: true }).fill("486");
    await page.getByRole("button", { name: "Save target", exact: true }).click();
    await expect(page.getByLabel("Required OJT hours", { exact: true })).toHaveValue("486");
    const profile = checked(
      await local.admin
        .from("profiles")
        .select("student_id, company, ojt_title, required_ojt_hours")
        .eq("id", legacyUserId)
        .single(),
    );
    expect(profile).toEqual({
      student_id: "LEGACY-001",
      company: "PSA (legacy test)",
      ojt_title: "Legacy Data Intern",
      required_ojt_hours: 486,
    });
  } finally {
    if (legacyUserId) checked(await local.admin.auth.admin.deleteUser(legacyUserId));
  }
});
