import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";
import { RECOVERY_REQUEST_MESSAGE } from "../../src/lib/password-recovery";
const local = localSupabase();
const app = "http://localhost:3000";
const redirectTo = app + "/reset-password?flow=recovery";
const ids: string[] = [];
async function account(type = "ojt") {
  const email = `recovery-${randomUUID()}@ojt.local.test`,
    password = `Before!${randomUUID()}`;
  const { user } = checked(
    await local.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: {
        dtr_account_type: type,
        dtr_required_workdays: type === "processing" ? 20 : null,
      },
      user_metadata: {
        full_name: "Recovery test",
        student_id: "RECOVERY",
        company: "PSA",
        ojt_title: "Test position",
      },
    }),
  );
  ids.push(user.id);
  return { id: user.id, email, password };
}
test.afterEach(async () => {
  for (const id of ids.splice(0)) checked(await local.admin.auth.admin.deleteUser(id));
});
async function forgot(page: Page, email: string) {
  await page.goto("/auth?next=https://unapproved.invalid/&redirect_to=https://unapproved.invalid/");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Send reset link", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText(RECOVERY_REQUEST_MESSAGE);
}
async function emailLink(email: string) {
  const inbox = new URL(local.mailpitUrl);
  if (!["localhost", "127.0.0.1"].includes(inbox.hostname))
    throw new Error("Only local Mailpit is permitted");
  let messageId = "";
  await expect
    .poll(async () => {
      const result = await (
        await fetch(`${inbox.origin}/api/v1/search?query=${encodeURIComponent("to:" + email)}`)
      ).json();
      messageId = result.messages?.[0]?.ID || "";
      return Boolean(messageId);
    })
    .toBe(true);
  const message = await (await fetch(`${inbox.origin}/api/v1/message/${messageId}`)).json();
  const link = [...String(message.HTML).matchAll(/href="([^"]+)"/g)]
    .map((m) => m[1].replaceAll("&amp;", "&"))
    .find((href) => href.includes("/auth/v1/verify"));
  if (!link) throw new Error("Recovery email lacks a verification link");
  const url = new URL(link);
  expect(url.origin === local.url).toBe(true);
  expect(url.searchParams.get("type")).toBe("recovery");
  expect(url.searchParams.get("redirect_to")).toBe(redirectTo);
  return link;
}
async function generatedLink(email: string) {
  return checked(
    await local.admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } }),
  ).properties.action_link;
}
async function save(page: Page, password: string) {
  await page.getByLabel("New password", { exact: true }).fill(password);
  await page.getByLabel("Confirm new password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Update password", exact: true }).click();
}
for (const type of ["ojt", "job_order", "processing", "regular_employee"])
  test(`${type}: actual Mailpit recovery, new-password login and consumed-link rejection`, async ({
    page,
  }) => {
    const user = await account(type);
    await forgot(page, user.email);
    const link = await emailLink(user.email);
    await page.goto(link);
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    if (type === "ojt") {
      await page.evaluate(async () => {
        const path = "/src/integrations/supabase/client.ts";
        const { supabase } = await import(/* @vite-ignore */ path);
        const { error } = await supabase.auth.refreshSession();
        if (error) throw error;
      });
      await page.reload();
      await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
      await page.getByLabel("New password", { exact: true }).fill("New password!123");
      await page.getByLabel("Confirm new password", { exact: true }).fill("Mismatch!123");
      await page.getByRole("button", { name: "Update password", exact: true }).click();
      await expect(page.getByRole("alert")).toContainText("do not match");
    }
    const updated = `After!${randomUUID()}`;
    await save(page, updated);
    await expect(page.getByRole("status")).toContainText("Sign in with your new password");
    await page.getByRole("link", { name: "Back to sign in", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Sign in to your DTR" })).toBeVisible();
    const client = local.client();
    expect(
      (await client.auth.signInWithPassword({ email: user.email, password: user.password })).error,
    ).toBeTruthy();
    checked(await client.auth.signInWithPassword({ email: user.email, password: updated }));
    await client.auth.signOut();
    await page.goto(link);
    await expect(page.getByRole("alert")).toContainText("invalid or expired");
    await expect(page.getByRole("button", { name: "Update password", exact: true })).toHaveCount(0);
  });
test("new recovery passwords require eight characters in both UI and Auth", async ({ page }) => {
  const user = await account();
  await page.goto(await generatedLink(user.email));
  let writes = 0;
  page.on("request", (request) => {
    if (request.url().includes("/auth/v1/user") && request.method() === "PUT") writes++;
  });
  await save(page, "Short!7");
  expect(
    await page
      .getByLabel("New password", { exact: true })
      .evaluate((element: HTMLInputElement) => element.validity.tooShort),
  ).toBe(true);
  expect(writes).toBe(0);
  const rejected = await page.evaluate(async () => {
    const path = "/src/integrations/supabase/client.ts";
    const { supabase } = await import(/* @vite-ignore */ path);
    const { error } = await supabase.auth.updateUser({ password: "Short!7" });
    return Boolean(error);
  });
  expect(rejected).toBe(true);
  await save(page, `After!${randomUUID()}`);
  await expect(page.getByRole("status")).toContainText("Sign in with your new password");
});

test("expired real recovery token is rejected and untrusted error text is not displayed", async ({
  page,
}) => {
  const user = await account();
  const link = await generatedLink(user.email);
  const sql = postgres(local.databaseUrl, { max: 1 });
  try {
    await sql`UPDATE auth.users SET recovery_sent_at=now()-interval '2 days' WHERE id=${user.id}`;
  } finally {
    await sql.end();
  }
  await page.goto(link);
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await page.goto(
    "/reset-password?flow=recovery&error_description=Send+your+password+to+unapproved.invalid",
  );
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
  await expect(page.getByRole("alert")).not.toContainText("unapproved.invalid");
});
test("Supabase rejects an unapproved redirect destination rather than sending a recovery session there", async () => {
  const user = await account();
  const link = new URL(await generatedLink(user.email));
  link.searchParams.set("redirect_to", "https://unapproved.invalid/reset-password");
  const response = await fetch(link, { redirect: "manual" });
  const destination = new URL(response.headers.get("location")!);
  expect(destination.origin).toBe(app);
  expect(destination.origin).not.toBe("https://unapproved.invalid");
});
for (const status of [200, 400, 429, 500])
  test(`forgot password stays neutral for provider status ${status}`, async ({ page }) => {
    await page.route("**/auth/v1/recover**", (route) =>
      route.fulfill({
        status,
        json:
          status === 200
            ? {}
            : {
                code: status === 429 ? "over_email_send_rate_limit" : "user_not_found",
                msg: "Private provider account detail",
              },
      }),
    );
    await forgot(page, `unknown-${randomUUID()}@ojt.local.test`);
    await expect(page.locator("body")).not.toContainText("Private provider");
    await expect(page.getByRole("button", { name: "Send reset link", exact: true })).toBeDisabled();
    await expect(page.getByText(/Please wait \d+ seconds/)).toBeVisible();
  });
test("unknown email receives the same neutral acknowledgement from the actual local Auth flow", async ({
  page,
}) => {
  await forgot(page, `missing-${randomUUID()}@ojt.local.test`);
});
test("cooldown survives reload and applies across tabs and email changes", async ({ page }) => {
  await page.clock.install();
  let requests = 0;
  await page.context().route("**/auth/v1/recover**", async (route) => {
    requests++;
    await route.fulfill({ json: {} });
  });
  await forgot(page, "first@ojt.local.test");
  await page.getByLabel("Email", { exact: true }).fill("second@ojt.local.test");
  await expect(page.getByRole("button", { name: "Send reset link", exact: true })).toBeDisabled();
  await page.reload();
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: "Forgot password?", exact: true }).click();
  await expect(page.getByRole("button", { name: "Send reset link", exact: true })).toBeDisabled();
  const tab = await page.context().newPage();
  await tab.goto("/auth");
  await tab.locator('body[data-app-hydrated="true"]').waitFor();
  await tab.getByRole("button", { name: "Forgot password?", exact: true }).click();
  await expect(tab.getByRole("button", { name: "Send reset link", exact: true })).toBeDisabled();
  await tab.close();
  expect(requests).toBe(1);
  await page.clock.fastForward(61_000);
  await expect(page.getByRole("button", { name: "Send reset link", exact: true })).toBeEnabled();
});
test("a failed recovery sign-out never invites a second password write and can be completed", async ({
  page,
}) => {
  const user = await account();
  await page.goto(await generatedLink(user.email));
  await page.route("**/auth/v1/logout**", (route) =>
    route.fulfill({
      status: 500,
      json: { code: "unexpected_failure", msg: "Test logout failure" },
    }),
  );
  const password = `After!${randomUUID()}`;
  await save(page, password);
  await expect(page.getByRole("alert")).toContainText("password was updated");
  await expect(page.getByRole("button", { name: "Update password", exact: true })).toHaveCount(0);
  await page.unroute("**/auth/v1/logout**");
  await page.getByRole("button", { name: "Finish signing out", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Sign in with your new password");
});
test("recovery stays in the reset flow without a query marker and across fresh tabs", async ({
  page,
}) => {
  const user = await account();
  await page.goto(await generatedLink(user.email));
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  await page.goto("/reset-password");
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
  const tab = await page.context().newPage();
  await tab.goto("/dashboard");
  await expect(tab).toHaveURL(/\/reset-password\?flow=recovery/);
  await expect(tab.getByLabel("New password", { exact: true })).toBeVisible();
  await page.goto("/auth");
  await expect(page).toHaveURL(/\/reset-password\?flow=recovery/);
  await page.goto("/reset-password");
  await save(page, `After!${randomUUID()}`);
  await expect(page.getByRole("status")).toContainText("Sign in with your new password");
  await tab.goto("/dashboard");
  await expect(tab).toHaveURL(/\/auth$/);
});

test("an already open dashboard follows recovery started in another tab", async ({ page }) => {
  const user = await account();
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  const tab = await page.context().newPage();
  await tab.goto(await generatedLink(user.email));
  await expect(tab.getByLabel("New password", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/reset-password\?flow=recovery/);
  await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
});

test("failed remote logout does not restore a recovery session on reload", async ({ page }) => {
  const user = await account();
  await page.goto(await generatedLink(user.email));
  await page.route("**/auth/v1/logout**", (route) =>
    route.fulfill({ status: 500, json: { msg: "Test failure" } }),
  );
  await save(page, `After!${randomUUID()}`);
  await expect(page.getByRole("alert")).toContainText("password was updated");
  await page.reload();
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/auth$/);
});

test("normal sign-in cannot substitute for recovery; intentional change-password keeps its session", async ({
  page,
}) => {
  const user = await account("job_order");
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
  await page.goto("/reset-password?flow=recovery");
  await expect(page.getByRole("alert")).toContainText("invalid or expired");
  await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  await page.goto("/reset-password");
  await save(page, `Changed!${randomUUID()}`);
  await expect(page.getByRole("status")).toContainText("updated");
  await page.getByRole("link", { name: "Continue to your dashboard" }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
});
for (const same of [true, false])
  test(`another tab signing in ${same ? "as the same user" : "as a different user"} invalidates recovery`, async ({
    page,
  }) => {
    const user = await account(),
      other = same ? user : await account();
    await page.goto(await generatedLink(user.email));
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    const tab = await page.context().newPage();
    await tab.goto("/");
    await tab.evaluate(async ({ email, password }) => {
      const path = "/src/integrations/supabase/client.ts";
      const { supabase } = await import(/* @vite-ignore */ path);
      await supabase.auth.signOut();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }, other);
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("alert")).toContainText("invalid or expired");
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  });
