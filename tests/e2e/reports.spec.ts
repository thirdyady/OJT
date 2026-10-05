import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";
const local = localSupabase();
const password = `Reports!${randomUUID()}`;
const users: { id: string; email: string; type: string; name: string }[] = [];
test.beforeAll(async () => {
  for (const type of ["ojt", "job_order", "processing", "regular_employee", "admin"]) {
    const email = `${randomUUID()}@ojt.local.test`;
    const name = `Reports ${type} ${randomUUID().slice(0, 8)}`;
    const { user } = checked(
      await local.admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: {
          dtr_account_type: type === "admin" ? "ojt" : type,
          dtr_required_ojt_hours: type === "ojt" ? 400 : null,
          dtr_required_workdays: type === "processing" ? 20 : null,
        },
        user_metadata: {
          full_name: name,
          student_id: "TEST",
          company: "PSA",
          ojt_title: "Analyst",
        },
      }),
    );
    users.push({ id: user.id, email, type, name });
    if (type === "admin")
      checked(await local.admin.from("profiles").update({ is_admin: true }).eq("id", user.id));
    else {
      checked(
        await local.admin.from("dtr_entries").insert([
          {
            user_id: user.id,
            entry_date: "2001-02-01",
            check_in: "2001-02-01T08:00:00+08:00",
            check_out: "2001-02-01T16:00:00+08:00",
          },
          { user_id: user.id, entry_date: "2001-02-02", check_in: "2001-02-02T08:00:00+08:00" },
        ]),
      );
      if (type === "processing")
        checked(await local.admin.from("profiles").update({ is_active: false }).eq("id", user.id));
    }
  }
});
test.afterAll(async () => {
  for (const u of users) {
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", u.id));
    checked(await local.admin.auth.admin.deleteUser(u.id));
  }
});
async function login(page: Page, type = "admin") {
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByLabel("Email", { exact: true }).fill(users.find((u) => u.type === type)!.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}
test("report filters, range totals, role targets, exports and stale-filter prevention", async ({
  page,
}) => {
  await login(page);
  const section = page.getByRole("region", { name: "Attendance reports", exact: true });
  // Simulate a deployment whose API page limit is below the requested size.
  await page.route("**/rest/v1/dtr_entries*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.has("entry_date")) url.searchParams.set("limit", "2");
    await route.continue({ url: url.toString() });
  });
  await section.getByLabel("Report start date").fill("2001-02-01");
  await section.getByLabel("Report end date").fill("2001-02-02");
  await section.getByRole("button", { name: "Generate report", exact: true }).click();
  const results = section.getByRole("region", { name: "Report results" });
  await expect(results).toBeVisible();
  for (const u of users.filter((u) => u.type !== "admin")) {
    const row = results.getByRole("row").filter({ hasText: u.name });
    await expect(row).toContainText("8.00");
    await expect(row).toContainText(
      u.type === "processing" ? "20 days" : u.type === "ojt" ? "400 hours" : "\u2014",
    );
  }
  await expect(results).not.toContainText(users.find((u) => u.type === "admin")!.name);
  await section.screenshot({ path: test.info().outputPath("reports-desktop.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await section.screenshot({ path: test.info().outputPath("reports-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const type of ["job_order", "regular_employee", "processing", "ojt"]) {
    await section.getByLabel("Report account type").selectOption(type);
    await expect(section.getByRole("button", { name: "Export report summary" })).toBeDisabled();
    await section.getByRole("button", { name: "Generate report", exact: true }).click();
    await expect(results).toContainText(users.find((u) => u.type === type)!.name);
    const pending = page.waitForEvent("download");
    await section.getByRole("button", { name: "Export report summary" }).click();
    const data = await readFile((await (await pending).path())!, "utf8");
    if (type === "job_order" || type === "regular_employee") {
      expect(data).not.toMatch(/Required|progress|percentage/i);
      await expect(results).not.toContainText("Applicable requirement");
    } else expect(data).toContain(type === "ojt" ? "Required hours" : "Required days");
  }
  await section.getByLabel("Report account type").selectOption("processing");
  await section.getByLabel("Report account status").selectOption("active");
  await section.getByRole("button", { name: "Generate report", exact: true }).click();
  await expect(section).not.toContainText(users.find((u) => u.type === "processing")!.name);
  await expect(section.getByText("No accounts match these filters.")).toBeVisible();
  await section.getByLabel("Report account status").selectOption("inactive");
  await section.getByRole("button", { name: "Generate report", exact: true }).click();
  await expect(results).toContainText(users.find((u) => u.type === "processing")!.name);
  const download = page.waitForEvent("download");
  await section.getByRole("button", { name: "Export attendance details" }).click();
  const details = await readFile((await (await download).path())!, "utf8");
  expect(details).toContain("08:00:00");
  expect(details).toContain("16:00:00");
  expect(details).toContain("2001-02-02");
  await section.getByLabel("Report end date").fill("2001-02-01");
  await section.getByRole("button", { name: "Generate report", exact: true }).click();
  await expect(results).toContainText(users.find((u) => u.type === "processing")!.name);
  const oneDayDownload = page.waitForEvent("download");
  await section.getByRole("button", { name: "Export attendance details" }).click();
  const oneDay = await readFile((await (await oneDayDownload).path())!, "utf8");
  expect(oneDay).toContain("2001-02-01");
  expect(oneDay).not.toContain("2001-02-02");
  await section.getByLabel("Report start date").fill("2001-03-01");
  await section.getByLabel("Report end date").fill("2001-03-31");
  await section.getByRole("button", { name: "Generate report", exact: true }).click();
  await expect(results).toContainText("No attendance in this period");
  await expect(section.getByRole("button", { name: "Export attendance details" })).toBeDisabled();
});
test("report errors and loading prevent export and duplicate generation", async ({ page }) => {
  await login(page);
  const section = page.getByRole("region", { name: "Attendance reports", exact: true });
  await section.getByLabel("Report start date").fill("2001-03-01");
  await section.getByLabel("Report end date").fill("2001-02-01");
  await section.getByRole("button", { name: "Generate report", exact: true }).click();
  await expect(section.getByRole("alert")).toContainText("valid date range");
  await section.getByLabel("Report start date").fill("2001-02-01");
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/rest/v1/dtr_entries*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("entry_date")) {
      await blocked;
      await route.fulfill({ status: 403, json: { code: "42501", message: "Report unavailable" } });
    } else await route.continue();
  });
  await section.getByRole("button", { name: "Generate report", exact: true }).click();
  try {
    await expect(section.getByRole("button", { name: "Working\u2026" })).toBeDisabled();
    await expect(section.getByLabel("Report account type")).toBeDisabled();
  } finally {
    release();
  }
  await expect(section.getByRole("alert")).toContainText("Report could not be loaded");
  await expect(section.getByRole("button", { name: "Export report summary" })).toBeDisabled();
});
test("ordinary accounts cannot access administrator reports", async ({ page }) => {
  await login(page, "job_order");
  await expect(page.getByRole("region", { name: "Attendance reports", exact: true })).toHaveCount(
    0,
  );
});
test("landing is usable on mobile and the sign-in link is keyboard accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your workday, recorded clearly.",
  );
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath("landing-mobile.png"), fullPage: true });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/auth$/);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.screenshot({ path: test.info().outputPath("landing-desktop.png"), fullPage: true });
});

test("reports recheck administrator authorization before export", async ({ page }) => {
  await login(page);
  const section = page.getByRole("region", { name: "Attendance reports", exact: true });
  await section.getByRole("button", { name: "Generate report", exact: true }).click();
  await expect(section.getByRole("button", { name: "Export report summary" })).toBeEnabled();
  await page.route("**/rest/v1/rpc/dtr_is_admin", (route) => route.fulfill({ json: false }));
  await section.getByRole("button", { name: "Export report summary" }).click();
  await expect(section.getByRole("alert")).toContainText("could not be authorized");
  await expect(section.getByRole("region", { name: "Report results" })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "Export report summary" })).toBeDisabled();
  await section.getByRole("button", { name: "Generate report", exact: true }).click();
  await expect(section.getByRole("alert")).toContainText(
    "administrator access could not be verified",
  );
});
