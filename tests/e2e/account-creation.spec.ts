import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { toJSONAsync } from "seroval";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";

const local = localSupabase();
const password = `Create!${randomUUID()}`;
const adminEmail = `${randomUUID()}@ojt.local.test`;
let adminId: string;
let emails: string[] = [];

test.beforeAll(async () => {
  const { user } = checked(
    await local.admin.auth.admin.createUser({
      email: adminEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: "Creation admin",
        student_id: "ADMIN",
        company: "PSA",
        ojt_title: "Admin",
      },
    }),
  );
  adminId = user.id;
  checked(await local.admin.from("profiles").update({ is_admin: true }).eq("id", adminId));
});
test.afterEach(async () => {
  const { users } = checked(await local.admin.auth.admin.listUsers({ perPage: 1000 }));
  for (const user of users.filter((u) => emails.includes(u.email!))) {
    checked(await local.admin.auth.admin.deleteUser(user.id));
  }
  emails = [];
  checked(await local.admin.from("profiles").update({ is_active: true }).eq("id", adminId));
});
test.afterAll(async () => {
  if (adminId) checked(await local.admin.auth.admin.deleteUser(adminId));
});

async function prepare(page: Page, type = "ojt") {
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByLabel("Email", { exact: true }).fill(adminEmail);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const form = page.locator("[data-admin-create-account-endpoint]");
  await expect(form).toBeVisible();
  await form.getByLabel("New account type").selectOption(type);
  const email = `${randomUUID()}@ojt.local.test`;
  emails.push(email);
  await form.getByLabel("New trainee full name").fill("Created employee");
  await form.getByLabel("New trainee email").fill(email);
  await form.getByLabel("New trainee temporary password", { exact: true }).fill(password);
  await form.getByLabel("Confirm new trainee password").fill(password);
  await form
    .getByLabel(type === "ojt" ? "New trainee host company" : "New account office")
    .fill("PSA");
  await form
    .getByLabel(type === "ojt" ? "New trainee OJT title" : "New account position")
    .fill("Test position");
  if (type === "ojt") {
    await form.getByLabel("New trainee student ID").fill("UNCHANGED-ID");
    await form.getByLabel("New trainee required OJT hours").fill("486");
  } else {
    await expect(form.getByLabel("New trainee student ID")).toHaveCount(0);
    await expect(form.getByLabel("New trainee required OJT hours")).toHaveCount(0);
  }
  if (type === "processing") await form.getByLabel("Required workdays").fill("90");
  else await expect(form.getByLabel("Required workdays")).toHaveCount(0);
  return {
    form,
    email,
    endpoint: (await form.getAttribute("data-admin-create-account-endpoint"))!,
  };
}

for (const type of ["ojt", "job_order", "processing", "regular_employee"]) {
  test(`Create Account supports ${type}, persists the profile, and suppresses duplicate submits`, async ({
    page,
  }) => {
    const { form, email, endpoint } = await prepare(page, type);
    let requests = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().includes(endpoint)) requests++;
    });
    await form.evaluate((element) => {
      element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await expect(form.getByRole("status")).toContainText("Account created");
    expect(requests).toBe(1);
    const { users } = checked(await local.admin.auth.admin.listUsers({ perPage: 1000 }));
    const user = users.find((u) => u.email === email)!;
    expect(user.email_confirmed_at).toBeTruthy();
    const row = checked(await local.admin.from("profiles").select().eq("id", user.id).single());
    expect(row.account_type).toBe(type);
    expect(row.student_id).toBe(type === "ojt" ? "UNCHANGED-ID" : null);
    expect(row.required_ojt_hours).toBe(type === "ojt" ? 486 : null);
    expect(row.required_workdays).toBe(type === "processing" ? 90 : null);
    expect(row.is_admin).toBe(false);
  });
}

test("invalid email and missing fields send no request or allocate an identifier; failure remains unsaved", async ({
  page,
}) => {
  const { form, email, endpoint } = await prepare(page);
  let requests = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes(endpoint)) requests++;
  });
  await form.getByLabel("New trainee email").fill("invalid-email");
  await form.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("valid email");
  expect(requests).toBe(0);
  await expect(form.getByLabel("New trainee student ID")).toHaveValue("UNCHANGED-ID");
  await form.getByLabel("New trainee email").fill(email);
  await form.getByLabel("New trainee full name").fill("   ");
  await form.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("Full name is required");
  expect(requests).toBe(0);
  await form.getByLabel("New trainee full name").fill("Retry employee");
  await page.route(
    (url) => url.href.includes(endpoint),
    (route) => route.abort(),
  );
  await form.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(form.getByRole("status")).toHaveCount(0);
  const { users } = checked(await local.admin.auth.admin.listUsers({ perPage: 1000 }));
  expect(users.some((u) => u.email === email)).toBe(false);
  await page.unrouteAll();
  await form.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("Account created");
});

test("trusted endpoint rejects invalid input, role injection and inactive administrators", async ({
  page,
}) => {
  const { endpoint, email } = await prepare(page, "job_order");
  const client = local.client();
  const { session } = checked(
    await client.auth.signInWithPassword({ email: adminEmail, password }),
  );
  const input = {
    accountType: "job_order",
    email,
    password,
    fullName: "Probe",
    company: "PSA",
    ojtTitle: "Clerk",
    studentId: null,
    requiredOjtHours: null,
    requiredWorkdays: null,
  };
  try {
    for (const patch of [
      { email: "invalid" },
      { is_admin: true },
      { accountType: "processing", requiredWorkdays: null },
    ]) {
      const body = JSON.stringify(await toJSONAsync({ data: { ...input, ...patch } }));
      const response = await page.request.post(endpoint, {
        headers: {
          Authorization: `Bearer ${session!.access_token}`,
          "content-type": "application/json",
          "x-tsr-serverFn": "true",
          Origin: "http://localhost:3000",
        },
        data: body,
      });
      expect(await response.text()).not.toContain('"profile"');
    }
    checked(await local.admin.from("profiles").update({ is_active: false }).eq("id", adminId));
    const body = JSON.stringify(await toJSONAsync({ data: input }));
    const response = await page.request.post(endpoint, {
      headers: {
        Authorization: `Bearer ${session!.access_token}`,
        "content-type": "application/json",
        "x-tsr-serverFn": "true",
        Origin: "http://localhost:3000",
      },
      data: body,
    });
    expect(await response.text()).toMatch(/Only DTR administrators/);
    const { users } = checked(await local.admin.auth.admin.listUsers({ perPage: 1000 }));
    expect(users.some((u) => u.email === email)).toBe(false);
  } finally {
    await client.auth.signOut();
  }
});
