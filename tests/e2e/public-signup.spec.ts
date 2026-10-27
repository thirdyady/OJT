import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";

test("home navigation sits below sign-in, signup and forgot-password forms", async ({ page }) => {
  for (const mode of ["signin", "signup", "forgot"]) {
    await page.goto("/auth");
    await page.locator('body[data-app-hydrated="true"]').waitFor();
    if (mode !== "signin")
      await page
        .getByRole("button", {
          name: mode === "signup" ? "Sign up" : "Forgot password?",
          exact: true,
        })
        .click();
    const home = page.getByRole("link", { name: "Back to home", exact: true });
    const form = (await page.locator("form").boundingBox())!,
      link = (await home.boundingBox())!;
    expect(link.y).toBeGreaterThan(form.y + form.height);
    await home.click();
    await expect(page).toHaveURL(/\/$/);
  }
});
const local = localSupabase();
for (const type of ["ojt", "job_order", "processing", "regular_employee"])
  test(`public signup offers and persists ${type}`, async ({ page }) => {
    const email = `${randomUUID()}@ojt.local.test`;
    let id: string | undefined;
    try {
      await page.goto("/auth");
      await page.locator('body[data-app-hydrated="true"]').waitFor();
      await page.getByRole("button", { name: "Sign up", exact: true }).click();
      await page.getByRole("combobox", { name: "Account type", exact: true }).selectOption(type);
      await expect(page.getByLabel("Position / Role", { exact: true })).toHaveAttribute(
        "placeholder",
        "(Administrative Officer IV, Intern, Etc..)",
      );
      await page.getByLabel("Full name", { exact: true }).fill("Public signup browser");
      if (type === "ojt") await page.getByLabel("Student ID", { exact: true }).fill("TEST-USER");
      else await expect(page.getByLabel("Student ID", { exact: true })).toHaveCount(0);
      await page
        .getByLabel(type === "ojt" ? "Host company" : "Office / Department", { exact: true })
        .fill("PSA");
      await page
        .getByLabel("Position / Role", { exact: true })
        .fill(type === "ojt" ? "Intern" : "Administrative Officer IV");
      if (type === "processing")
        await page.getByLabel("Required workdays", { exact: true }).fill("20");
      else await expect(page.getByLabel("Required workdays", { exact: true })).toHaveCount(0);
      await page.getByLabel(/^Email(?: or username)?$/).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(`Signup!${randomUUID()}`);
      await page.getByRole("button", { name: "Create account", exact: true }).click();
      await expect(page.getByRole("status")).toContainText("Check your email to confirm");
      const { users } = checked(await local.admin.auth.admin.listUsers({ perPage: 1000 }));
      const user = users.find((u) => u.email === email)!;
      id = user?.id;
      expect(id).toBeTruthy();
      expect(user.email_confirmed_at).toBeFalsy();
      const profile = checked(await local.admin.from("profiles").select().eq("id", id!).single());
      expect(profile.account_type).toBe(type);
      expect(profile.is_admin).toBe(false);
      expect(profile.required_workdays).toBe(type === "processing" ? 20 : null);
    } finally {
      if (!id) {
        const { users } = checked(await local.admin.auth.admin.listUsers({ perPage: 1000 }));
        id = users.find((u) => u.email === email)?.id;
      }
      if (id) checked(await local.admin.auth.admin.deleteUser(id));
    }
  });
test("signup requires Processing days and rejects whitespace without sending signup", async ({
  page,
}) => {
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Account type", exact: true })
    .selectOption("processing");
  for (const label of ["Full name", "Office / Department", "Position / Role"])
    await page.getByLabel(label, { exact: true }).fill("   ");
  await page.getByLabel(/^Email(?: or username)?$/).fill("invalid-input@ojt.local.test");
  await page.getByLabel("Password", { exact: true }).fill("Signup-test-password");
  let requests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/auth/v1/signup")) requests++;
  });
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  expect(requests).toBe(0);
  await page.getByLabel("Required workdays", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Complete all required account details");
  expect(requests).toBe(0);
  for (const label of ["Full name", "Office / Department", "Position / Role"])
    await page.getByLabel(label, { exact: true }).fill("Valid details");
  await page.getByLabel("Password", { exact: true }).fill("Short!7");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  expect(
    await page
      .getByLabel("Password", { exact: true })
      .evaluate((element: HTMLInputElement) => element.validity.tooShort),
  ).toBe(true);
  expect(requests).toBe(0);
});
