import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { toJSONAsync } from "seroval";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";

const local = localSupabase();
const password = `Test!${randomUUID()}`;
const email = `browser-${randomUUID()}@ojt.local.test`;
const originalStudentId = `BROWSER-ORIGINAL-${randomUUID()}`;
const updatedStudentId = `BROWSER-UPDATED-${randomUUID()}`;
let userId: string;
let adminId: string;
const adminEmail = `admin-browser-${randomUUID()}@ojt.local.test`;
let createdUserId: string | undefined;
let createdEmail: string | undefined;

async function waitForHydration(page: import("@playwright/test").Page) {
  await page.locator('body[data-app-hydrated="true"]').waitFor();
}

test.beforeAll(async () => {
  userId = checked(
    await local.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: "Browser Test Trainee",
        student_id: originalStudentId,
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
  if (userId) checked(await local.admin.from("dtr_entries").delete().eq("user_id", userId));
  if (userId) checked(await local.admin.auth.admin.deleteUser(userId));
  if (adminId) checked(await local.admin.auth.admin.deleteUser(adminId));
  if (createdUserId) checked(await local.admin.auth.admin.deleteUser(createdUserId));
});

test("the root URL redirects signed-out visitors to sign in", async ({ page }) => {
  await page.goto("/");
  await waitForHydration(page);
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("heading", { name: "Sign in to your DTR" })).toBeVisible();
});

test("attendance persists, failed writes stay unsaved, undo needs confirmation, admin can edit, inspect and clear", async ({
  page,
}) => {
  await page.goto("/dashboard");
  await waitForHydration(page);
  await expect(page).toHaveURL(/\/auth$/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Check In now", exact: true })).toBeVisible();
  await expect(page.getByAltText("Philippine Statistics Authority")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Manage Accounts" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "OJT progress" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "OJT completion" })).toBeVisible();
  await expect(page.getByText("OJT target reached!")).toBeVisible();
  await page.getByLabel("Student ID", { exact: true }).fill(updatedStudentId);
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
  await waitForHydration(stalePage);
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
  await expect(stalePage.getByRole("alert")).toContainText("out of date");
  await expect(
    stalePage.getByRole("button", { name: "Reload records", exact: true }),
  ).toBeVisible();
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
  await expect(page.getByRole("heading", { name: "Manage Accounts" })).toBeVisible();
  await page.getByPlaceholder("Search name, ID, company…").fill(updatedStudentId);
  await page.getByRole("button", { name: /Browser Test Trainee/ }).click();
  await expect(page.getByText("OJT: Browser Test Intern")).toBeVisible();
  await expect(page.getByLabel("Full Name", { exact: true })).toHaveValue("Browser Test Trainee");
  await page.getByLabel("Full Name", { exact: true }).fill("Browser Test Trainee Updated");
  await page.getByLabel("Student ID", { exact: true }).fill(updatedStudentId);
  await page.getByLabel("Host Company", { exact: true }).fill("PSA (updated browser test)");
  await page.getByLabel("OJT Title", { exact: true }).fill("Updated Browser Intern");
  await expect(page.getByLabel("Required OJT hours", { exact: true })).toHaveValue("8");
  await page.getByLabel("Required OJT hours", { exact: true }).fill("500");
  await page.getByRole("button", { name: "Save trainee profile", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("saved");
  await expect(page.getByLabel("OJT Title", { exact: true })).toHaveValue("Updated Browser Intern");
  await expect(page.getByLabel("Required OJT hours", { exact: true })).toHaveValue("500");
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Deactivate account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("deactivated");
  await expect(page.getByText("Inactive", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Reactivate account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("reactivated");
  await expect(page.getByText("Active", { exact: true })).toBeVisible();
  const clear = page.getByTitle("Clear Check Out").filter({ visible: true });
  await expect(clear).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await clear.click();
  await expect(clear).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await clear.click();
  await expect(clear).toHaveCount(0);
});

test("admin creates a complete trainee account while a trainee cannot invoke the endpoint", async ({
  page,
}) => {
  createdEmail = `created-${randomUUID()}@ojt.local.test`;
  const createdPassword = `Created!${randomUUID()}`;
  const createdStudentId = `SERVER-CREATED-${randomUUID()}`;
  await page.goto("/auth");
  await waitForHydration(page);
  await page.getByLabel("Email", { exact: true }).fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Create trainee account" })).toBeVisible();
  const endpoint = await page
    .locator("[data-admin-create-account-endpoint]")
    .getAttribute("data-admin-create-account-endpoint");
  expect(endpoint).toBeTruthy();
  await page.getByLabel("New trainee full name", { exact: true }).fill("Server Created Trainee");
  await page.getByLabel("New trainee student ID", { exact: true }).fill(createdStudentId);
  await page
    .getByLabel("New trainee host company", { exact: true })
    .fill("PSA (server account test)");
  await page.getByLabel("New trainee OJT title", { exact: true }).fill("Systems Intern");
  await page.getByLabel("New trainee email", { exact: true }).fill(createdEmail);
  await page.getByLabel("New trainee temporary password", { exact: true }).fill(createdPassword);
  await page.getByLabel("Confirm new trainee password", { exact: true }).fill(createdPassword);
  await page.getByLabel("New trainee required OJT hours", { exact: true }).fill("486");
  await page.getByRole("button", { name: "Create trainee account", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Account created");
  const { users } = checked(await local.admin.auth.admin.listUsers({ perPage: 1000 }));
  createdUserId = users.find((user) => user.email === createdEmail)?.id;
  expect(createdUserId).toBeTruthy();
  const createdProfile = checked(
    await local.admin
      .from("profiles")
      .select("full_name, student_id, company, ojt_title, required_ojt_hours, is_admin, is_active")
      .eq("id", createdUserId!)
      .single(),
  );
  expect(createdProfile).toEqual({
    full_name: "Server Created Trainee",
    student_id: createdStudentId,
    company: "PSA (server account test)",
    ojt_title: "Systems Intern",
    required_ojt_hours: 486,
    is_admin: false,
    is_active: true,
  });
  const createdSession = local.client();
  const createdSignIn = checked(
    await createdSession.auth.signInWithPassword({
      email: createdEmail,
      password: createdPassword,
    }),
  );
  expect(createdSignIn.user?.id).toBe(createdUserId);
  await createdSession.auth.signOut();

  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Manage Accounts" })).toHaveCount(0);

  const traineeSession = local.client();
  const signedIn = checked(await traineeSession.auth.signInWithPassword({ email, password }));
  const accessToken = signedIn.session?.access_token;
  expect(accessToken).toBeTruthy();
  const probeEmail = `probe-${randomUUID()}@ojt.local.test`;
  const serializedProbe = JSON.stringify(
    await toJSONAsync({
      data: {
        email: probeEmail,
        password: "Probe!Password123",
        fullName: "Unauthorized Probe",
        studentId: "UNAUTHORIZED-PROBE",
        company: "Nope",
        ojtTitle: "Nope",
        requiredOjtHours: 486,
      },
    }),
  );
  const response = await page.evaluate(
    async ({ endpointPath, token, serializedBody }) => {
      const response = await fetch(
        endpointPath!.startsWith("http") ? endpointPath! : `http://localhost:3000${endpointPath}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "content-type": "application/json",
            accept: "application/json",
            "x-tsr-serverFn": "true",
          },
          body: serializedBody,
        },
      );
      return { status: response.status, body: await response.text() };
    },
    { endpointPath: endpoint, token: accessToken, serializedBody: serializedProbe },
  );
  // TanStack Start returns a serialized RPC error envelope for raw callers;
  // the operation is rejected before any Auth user is created.
  expect(response.body).toMatch(/Only DTR administrators can create trainee accounts/i);
  const { users: usersAfterProbe } = checked(
    await local.admin.auth.admin.listUsers({ perPage: 1000 }),
  );
  expect(usersAfterProbe.some((user) => user.email === probeEmail)).toBe(false);
  await traineeSession.auth.signOut();
});

test("an already-signed-in trainee loses DTR access after deactivation and returns after reactivation", async ({
  page,
}) => {
  await page.goto("/auth");
  await waitForHydration(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const nextPunch = page.getByRole("button", {
    name: /^(Check In|Break Out|Break In|Check Out) now$/,
  });
  await expect(nextPunch).toBeVisible();

  const adminSession = local.client();
  checked(await adminSession.auth.signInWithPassword({ email: adminEmail, password }));
  checked(
    await adminSession.rpc("dtr_admin_set_account_active", {
      target_user_id: userId,
      target_active: false,
    }),
  );

  await nextPunch.click();
  await expect(page).toHaveURL(/\/auth$/);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

  checked(
    await adminSession.rpc("dtr_admin_set_account_active", {
      target_user_id: userId,
      target_active: true,
    }),
  );
  await adminSession.auth.signOut();

  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /^(Check In|Break Out|Break In|Check Out) now$/ }),
  ).toBeVisible();
});

test("forgot password requests a recovery email; recovery updates the password; expired links show an error", async ({
  page,
}) => {
  await page.goto("/auth");
  await waitForHydration(page);
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
  await page.getByLabel("Email", { exact: true }).fill(email);
  let recoveryRequestBody: Record<string, unknown> | undefined;
  let recoveryRequestUrl = "";
  page.on("request", (request) => {
    if (request.url().includes("/auth/v1/recover") && request.method() === "POST") {
      recoveryRequestUrl = request.url();
      try {
        recoveryRequestBody = JSON.parse(request.postData() || "{}");
      } catch {
        recoveryRequestBody = undefined;
      }
    }
  });
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/If an account exists/)).toBeVisible();
  const requestRedirect =
    recoveryRequestBody?.redirect_to ||
    (recoveryRequestUrl ? new URL(recoveryRequestUrl).searchParams.get("redirect_to") : null);
  expect(requestRedirect).toBe("http://localhost:3000/reset-password?flow=recovery");
  const data = checked(
    await local.admin.auth.admin.generateLink({
      type: "recovery",
      email,
      options: { redirectTo: "http://localhost:3000/reset-password?flow=recovery" },
    }),
  );
  await page.goto(data.properties.action_link);
  await waitForHydration(page);
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const path = "/src/integrations/supabase/client.ts";
    const { supabase } = await import(/* @vite-ignore */ path);
    const { error } = await supabase.auth.refreshSession();
    if (error) throw error;
  });
  await page.reload();
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  const newPassword = `Updated!${randomUUID()}`;
  await page.getByLabel("New password", { exact: true }).fill(newPassword);
  await page.getByLabel("Confirm new password", { exact: true }).fill("different-password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("alert")).toContainText("do not match");
  await page.getByLabel("Confirm new password", { exact: true }).fill(newPassword);
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("status")).toContainText("updated");
  await expect(page.getByRole("status")).toContainText("Sign in with your new password");
  await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
  const client = local.client();
  checked(await client.auth.signInWithPassword({ email, password: newPassword }));
  await client.auth.signOut();
  checked(await local.admin.auth.admin.updateUserById(userId, { password }));
  await page.goto("/reset-password#error=access_denied&error_description=Link+expired");
  await waitForHydration(page);
  await expect(page.getByRole("alert")).toContainText("Link expired");
  await expect(page.getByRole("button", { name: "Update password" })).toHaveCount(0);
});

test("signed-in change password keeps the session and rejects an invalid recovery link", async ({
  page,
}) => {
  const changeEmail = `browser-change-${randomUUID()}@ojt.local.test`;
  const changePassword = `Change!${randomUUID()}`;
  const updatedPassword = `Changed!${randomUUID()}`;
  let changeUserId: string | undefined;
  try {
    changeUserId = checked(
      await local.admin.auth.admin.createUser({
        email: changeEmail,
        password: changePassword,
        email_confirm: true,
        user_metadata: {
          full_name: "Change Password Trainee",
          student_id: `CHANGE-${randomUUID()}`,
          company: "PSA (change test)",
          ojt_title: "Change Intern",
        },
      }),
    ).user.id;

    await page.goto("/auth");
    await waitForHydration(page);
    await page.getByLabel("Email", { exact: true }).fill(changeEmail);
    await page.getByLabel("Password", { exact: true }).fill(changePassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: /now$/ }).first()).toBeVisible();

    await page.getByRole("link", { name: "Change password", exact: true }).click();
    await waitForHydration(page);
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill(updatedPassword);
    await page.getByLabel("Confirm new password", { exact: true }).fill(updatedPassword);
    await page.getByRole("button", { name: "Update password", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Your password has been updated.");
    await expect(page.getByRole("link", { name: "Continue to your dashboard" })).toBeVisible();
    await page.getByRole("link", { name: "Continue to your dashboard" }).click();
    await expect(page.getByRole("button", { name: /now$/ }).first()).toBeVisible();

    await page.goto("/reset-password#error=access_denied&error_description=Link+expired");
    await waitForHydration(page);
    await expect(page.getByRole("alert")).toContainText("Link expired");
    await expect(page.getByRole("button", { name: "Update password", exact: true })).toHaveCount(0);
    await page.goto("/reset-password?flow=recovery");
    await waitForHydration(page);
    await expect(page.getByRole("alert")).toContainText("invalid or expired");
    await expect(page.getByRole("button", { name: "Update password", exact: true })).toHaveCount(0);
    await page.goto("/dashboard");
    await expect(page.getByRole("button", { name: /now$/ }).first()).toBeVisible();
  } finally {
    if (changeUserId) checked(await local.admin.auth.admin.deleteUser(changeUserId));
  }
});

for (const switchAccount of [false, true]) {
  test(`recovery is invalidated after ${switchAccount ? "another account" : "the same account"} signs in`, async ({
    page,
  }) => {
    const accounts: { id: string; email: string }[] = [];
    const originalPassword = `Recovery!${randomUUID()}`;
    try {
      for (let i = 0; i < (switchAccount ? 2 : 1); i++) {
        const email = `recovery-session-${randomUUID()}@ojt.local.test`;
        const { user } = checked(
          await local.admin.auth.admin.createUser({
            email,
            password: originalPassword,
            email_confirm: true,
          }),
        );
        accounts.push({ id: user.id, email });
      }
      const link = checked(
        await local.admin.auth.admin.generateLink({
          type: "recovery",
          email: accounts[0].email,
          options: { redirectTo: "http://localhost:3000/reset-password?flow=recovery" },
        }),
      );
      await page.goto(link.properties.action_link);
      await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
      await page.getByLabel("New password", { exact: true }).fill("ShouldNotBeSaved!123");
      await page.getByLabel("Confirm new password", { exact: true }).fill("ShouldNotBeSaved!123");
      const otherTab = await page.context().newPage();
      await otherTab.goto("/auth");
      await waitForHydration(otherTab);
      await otherTab.evaluate(
        async ({ email, password }) => {
          const path = "/src/integrations/supabase/client.ts";
          const { supabase } = await import(/* @vite-ignore */ path);
          const logout = await supabase.auth.signOut();
          if (logout.error) throw logout.error;
          const login = await supabase.auth.signInWithPassword({ email, password });
          if (login.error) throw login.error;
        },
        { email: accounts[switchAccount ? 1 : 0].email, password: originalPassword },
      );
      await expect(page.getByRole("button", { name: "Update password", exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole("alert")).toContainText("invalid or expired");
      await page.reload();
      await expect(page.getByRole("button", { name: "Update password", exact: true })).toHaveCount(
        0,
      );
      await expect(page.getByRole("alert")).toContainText("invalid or expired");
      for (const account of accounts) {
        const client = local.client();
        checked(
          await client.auth.signInWithPassword({
            email: account.email,
            password: originalPassword,
          }),
        );
        await client.auth.signOut();
      }
      await otherTab.close();
    } finally {
      for (const account of accounts) checked(await local.admin.auth.admin.deleteUser(account.id));
    }
  });
}

test("new trainee registration requires complete profile details", async ({ page }) => {
  const signupEmail = `browser-signup-${randomUUID()}@ojt.local.test`;
  let signupUserId: string | undefined;
  try {
    await page.goto("/auth");
    await waitForHydration(page);
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
    await waitForHydration(page);
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
    await expect(page.getByRole("button", { name: "Save target", exact: true })).toHaveCount(0);
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
