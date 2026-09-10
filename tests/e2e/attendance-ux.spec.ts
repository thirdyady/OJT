import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";

const local = localSupabase();
let trainee: { id: string; email: string; name: string; password: string };
let admin: { id: string; email: string; password: string };

async function waitForHydration(page: Page) {
  await page.locator('body[data-app-hydrated="true"]').waitFor();
}

async function login(page: Page, account: { email: string; password: string }) {
  await page.goto("/auth");
  await waitForHydration(page);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}

async function todayKey(page: Page) {
  return page.evaluate(() => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
}

test.beforeEach(async () => {
  const password = `Attendance!${randomUUID()}`;
  const traineeName = `UX Trainee ${randomUUID().slice(0, 8)}`;
  const traineeEmail = `${randomUUID()}@ojt.local.test`;
  const adminEmail = `${randomUUID()}@ojt.local.test`;
  trainee = {
    id: checked(
      await local.admin.auth.admin.createUser({
        email: traineeEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: traineeName,
          student_id: traineeName,
          company: "PSA",
          ojt_title: "Attendance UX Intern",
        },
      }),
    ).user.id,
    email: traineeEmail,
    name: traineeName,
    password,
  };
  admin = {
    id: checked(
      await local.admin.auth.admin.createUser({
        email: adminEmail,
        password,
        email_confirm: true,
        user_metadata: { full_name: "Attendance UX Admin" },
      }),
    ).user.id,
    email: adminEmail,
    password,
  };
  checked(await local.admin.from("profiles").update({ is_admin: true }).eq("id", admin.id));
  checked(
    await local.admin.from("profiles").update({ required_ojt_hours: 8 }).eq("id", trainee.id),
  );
});

test.afterEach(async () => {
  for (const account of [trainee, admin]) {
    if (!account?.id) continue;
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", account.id));
    const profile = checked(await local.admin.from("profiles").select("id").eq("id", account.id));
    if (profile.length) checked(await local.admin.auth.admin.deleteUser(account.id));
  }
});

test("rapid clicks save once, the full sequence works, and undo confirms every step", async ({
  page,
}) => {
  await login(page, trainee);
  const checkIn = page.getByRole("button", { name: "Check In now", exact: true });
  let writes = 0;
  page.on("request", (request) => {
    if (request.url().includes("/rest/v1/dtr_entries") && request.method() === "POST") writes++;
  });

  await checkIn.dblclick();
  await expect(page.getByRole("button", { name: "Break Out now", exact: true })).toBeVisible();
  expect(writes).toBe(1);
  await expect(page.getByRole("status").filter({ hasText: "Day in progress" })).toContainText(
    "next step: Break Out",
  );

  for (const [current, next] of [
    ["Break Out", "Break In"],
    ["Break In", "Check Out"],
  ]) {
    await page.getByRole("button", { name: `${current} now`, exact: true }).click();
    await expect(page.getByRole("button", { name: `${next} now`, exact: true })).toBeVisible();
  }
  await page.getByRole("button", { name: "Check Out now", exact: true }).click();
  await expect(page.getByText(/Day complete/)).toBeVisible();

  const dialogMessages: string[] = [];
  for (const next of ["Check Out", "Break In", "Break Out", "Check In"]) {
    page.once("dialog", (dialog) => {
      dialogMessages.push(dialog.message());
      dialog.accept();
    });
    await page.getByRole("button", { name: "Undo last", exact: true }).click();
    await expect(page.getByRole("button", { name: `${next} now`, exact: true })).toBeVisible();
  }
  expect(dialogMessages).toHaveLength(4);
  expect(dialogMessages[0]).toContain("Undo Check Out recorded at");
  expect(dialogMessages[0]).toContain("reopens it as the next step");
});

test("failed saves remain unsaved and stale tabs get an explicit reload action", async ({
  page,
}) => {
  await login(page, trainee);
  await page.route("**/rest/v1/dtr_entries*", async (route) => {
    if (route.request().method() === "POST") return route.abort("failed");
    return route.continue();
  });
  await page.getByRole("button", { name: "Check In now", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Attendance was not saved");
  await expect(page.getByRole("button", { name: "Check In now", exact: true })).toBeEnabled();
  await page.unroute("**/rest/v1/dtr_entries*");

  const stalePage = await page.context().newPage();
  await stalePage.goto("/dashboard");
  await waitForHydration(stalePage);
  await expect(stalePage.getByRole("button", { name: "Check In now", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Check In now", exact: true }).click();
  await expect(page.getByRole("button", { name: "Break Out now", exact: true })).toBeVisible();
  await stalePage.getByRole("button", { name: "Check In now", exact: true }).click();
  await expect(stalePage.getByRole("alert")).toContainText("out of date");
  const reload = stalePage.getByRole("button", { name: "Reload records", exact: true });
  await expect(reload).toBeVisible();
  await reload.click();
  await expect(stalePage.getByRole("button", { name: "Break Out now", exact: true })).toBeVisible();
  await stalePage.close();
});

test("normal in-progress records stay quiet while inconsistent records are warned", async ({
  page,
}) => {
  await login(page, trainee);
  const date = await todayKey(page);
  checked(
    await local.admin.from("dtr_entries").insert({
      user_id: trainee.id,
      entry_date: date,
      check_in: `${date}T08:00:00+08:00`,
      break_out: `${date}T12:00:00+08:00`,
    }),
  );
  await page.reload();
  await expect(page.getByRole("status").filter({ hasText: "Day in progress" })).toContainText(
    "next step: Break In",
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText(/Completed.*0\.00 hrs/)).toBeVisible();

  checked(
    await local.admin
      .from("dtr_entries")
      .update({ check_out: `${date}T17:00:00+08:00` })
      .eq("user_id", trainee.id)
      .eq("entry_date", date),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("punches out of order");
  await expect(page.getByRole("status").filter({ hasText: "Day in progress" })).toHaveCount(0);
  await expect(page.getByText(/Completed.*0\.00 hrs/)).toBeVisible();
});

test("an admin-cleared punch is reported as stale and can be refreshed safely", async ({
  page,
  browser,
}) => {
  await login(page, trainee);
  const date = await todayKey(page);
  checked(
    await local.admin.from("dtr_entries").insert({
      user_id: trainee.id,
      entry_date: date,
      check_in: `${date}T08:00:00+08:00`,
      break_out: `${date}T12:00:00+08:00`,
    }),
  );
  await page.reload();
  await expect(page.getByRole("button", { name: "Break In now", exact: true })).toBeVisible();

  const adminContext = await browser.newContext({ timezoneId: "Asia/Manila" });
  const adminPage = await adminContext.newPage();
  try {
    await login(adminPage, admin);
    await adminPage.getByRole("button", { name: new RegExp(trainee.name) }).click();
    const clearBreakOut = adminPage.locator('button[title="Clear Break Out"]:visible');
    await expect(clearBreakOut).toBeVisible();
    let confirmation = "";
    adminPage.once("dialog", (dialog) => {
      confirmation = dialog.message();
      dialog.accept();
    });
    await clearBreakOut.click();
    expect(confirmation).toContain("may make the day incomplete");
  } finally {
    await adminContext.close();
  }

  await page.getByRole("button", { name: "Break In now", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("out of date");
  await page.getByRole("button", { name: "Reload records", exact: true }).click();
  await expect(page.getByRole("button", { name: "Break Out now", exact: true })).toBeVisible();
});

test("warnings agree with valid no-break days and checkout at break-in", async ({ page }) => {
  await login(page, trainee);
  const date = await todayKey(page);
  const row = checked(
    await local.admin
      .from("dtr_entries")
      .insert({
        user_id: trainee.id,
        entry_date: date,
        check_in: `${date}T08:00:00+08:00`,
        check_out: `${date}T17:00:00+08:00`,
      })
      .select()
      .single(),
  );
  await page.reload();
  await expect(page.getByText(/Completed.*9\.00 hrs/)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  checked(
    await local.admin
      .from("dtr_entries")
      .update({
        break_out: `${date}T12:00:00+08:00`,
        break_in: `${date}T17:00:00+08:00`,
      })
      .eq("id", row.id),
  );
  await page.reload();
  await expect(page.getByText(/Completed.*4\.00 hrs/)).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);

  // A complete-looking but reversed interval must still be warned/excluded.
  checked(
    await local.admin
      .from("dtr_entries")
      .update({
        break_out: null,
        break_in: null,
        check_out: `${date}T07:00:00+08:00`,
      })
      .eq("id", row.id),
  );
  await page.reload();
  await expect(page.getByRole("alert")).toContainText("inconsistent punch times");
  await expect(page.getByText(/Completed.*0\.00 hrs/)).toBeVisible();
});

test("stale full-entry deletion preserves newer punches until reload and reconfirmation", async ({
  page,
}) => {
  await login(page, admin);
  const date = await todayKey(page);
  const row = checked(
    await local.admin
      .from("dtr_entries")
      .insert({
        user_id: trainee.id,
        entry_date: date,
        check_in: `${date}T08:00:00+08:00`,
      })
      .select()
      .single(),
  );
  await page.getByRole("button", { name: new RegExp(trainee.name) }).click();
  const remove = page
    .getByRole("button", { name: "Delete", exact: true })
    .filter({ visible: true });
  await expect(remove).toBeVisible();
  const checkOut = `${date}T17:00:00+08:00`;
  checked(await local.admin.from("dtr_entries").update({ check_out: checkOut }).eq("id", row.id));
  page.once("dialog", (dialog) => dialog.accept());
  await remove.click();
  await expect(page.getByRole("alert")).toContainText("changed in another tab");
  const saved = checked(
    await local.admin.from("dtr_entries").select("check_out").eq("id", row.id).single(),
  );
  expect(Date.parse(saved.check_out)).toBe(Date.parse(checkOut));

  await page.getByRole("button", { name: "Reload records", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(trainee.name) }).click();
  await expect(remove).toBeVisible();
  page.once("dialog", (dialog) => dialog.dismiss());
  await remove.click();
  await expect(remove).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await remove.click();
  await expect(remove).toHaveCount(0);
  expect(checked(await local.admin.from("dtr_entries").select("id").eq("id", row.id))).toHaveLength(
    0,
  );
});

test("attendance remains usable by keyboard at a narrow mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await login(page, trainee);
  const checkIn = page.getByRole("button", { name: "Check In now", exact: true });
  await checkIn.focus();
  expect(await checkIn.evaluate((element) => document.activeElement === element)).toBe(true);
  await checkIn.press("Enter");
  await expect(page.getByRole("button", { name: "Break Out now", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    (await page.evaluate(() => document.documentElement.clientWidth)) + 1,
  );
});
