import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";

const local = localSupabase();
const password = `Dashboard!${randomUUID()}`;
const types = ["ojt", "job_order", "processing", "regular_employee"];
const users: { id: string; email: string; type: string; name: string }[] = [];
test.beforeAll(async () => {
  for (const type of [...types, "admin"]) {
    const email = `${randomUUID()}@ojt.local.test`;
    const name = `Dashboard ${type} ${randomUUID().slice(0, 8)}`;
    const { user } = checked(
      await local.admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: {
          dtr_account_type: type === "admin" ? "ojt" : type,
          dtr_required_workdays: type === "processing" ? 4 : null,
          dtr_required_ojt_hours: type === "ojt" ? 16 : null,
        },
        user_metadata: {
          full_name: name,
          student_id: "TEST",
          company: "PSA office",
          ojt_title: "Analyst",
        },
      }),
    );
    users.push({ id: user.id, email, type, name });
    if (type === "admin")
      checked(await local.admin.from("profiles").update({ is_admin: true }).eq("id", user.id));
    else
      checked(
        await local.admin.from("dtr_entries").insert([
          {
            user_id: user.id,
            entry_date: "2000-01-01",
            check_in: "2000-01-01T08:00:00+08:00",
            check_out: "2000-01-01T16:00:00+08:00",
          },
          { user_id: user.id, entry_date: "2000-01-02", check_in: "2000-01-02T08:00:00+08:00" },
        ]),
      );
  }
});
test.afterAll(async () => {
  for (const user of users) {
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", user.id));
    checked(await local.admin.auth.admin.deleteUser(user.id));
  }
});
async function login(page: Page, user: (typeof users)[number]) {
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}
for (const type of types)
  test(`${type} sees only its own profile and appropriate progress; RLS rejects other accounts`, async ({
    page,
  }) => {
    const user = users.find((u) => u.type === type)!;
    const other = users.find((u) => u.type !== type && u.type !== "admin")!;
    await login(page, user);
    await page.goto(`/dashboard?user_id=${other.id}`);
    await expect(page.getByRole("heading", { name: "Manage Accounts" })).toHaveCount(0);
    await expect(page.getByText(other.name, { exact: true })).toHaveCount(0);
    if (type === "ojt" || type === "processing") {
      const label = type === "ojt" ? "OJT" : "Processing";
      await expect(page.getByRole("progressbar", { name: `${label} completion` })).toHaveAttribute(
        "aria-valuenow",
        type === "ojt" ? "50" : "25",
      );
    } else {
      await expect(page.getByRole("region", { name: "Attendance summary" })).toContainText(
        "8.00 hrs",
      );
      await expect(page.getByRole("progressbar")).toHaveCount(0);
      await expect(page.getByLabel("Required OJT hours")).toHaveCount(0);
    }
    if (type !== "ojt") {
      const profile = page.getByRole("region", { name: "Account profile" });
      await expect(profile).toContainText("Office / Department");
      await expect(profile).toContainText("Analyst");
      await expect(profile).not.toContainText("Student ID");
    }
    await expect(page.getByRole("button", { name: /Undo last/i })).toHaveCount(0);
    if (type !== "ojt") await expect(page.locator("body")).not.toContainText("OJT");
    await page.getByRole("button", { name: "Print DTR", exact: true }).click();
    await expect(page.frameLocator("iframe").locator(".profile-line").first()).toHaveText(
      `${type === "ojt" ? "OJT Title" : "Position"}: Analyst`,
    );
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Word", exact: true }).click();
    const word = await readFile((await (await download).path())!, "utf8");
    expect(word).toContain(
      `${type === "ojt" ? "OJT Title" : "Position"}: <strong>Analyst</strong>`,
    );
    if (type !== "ojt") expect(word).not.toContain("OJT Title");
    if (type === "ojt") expect(word).toContain("Required hours: 16");
    else if (type === "processing") expect(word).toContain("Required days: 4");
    else
      expect(word).not.toMatch(/Required hours|Required days|Completed valid workdays|progress/i);
    const client = local.client();
    checked(await client.auth.signInWithPassword({ email: user.email, password }));
    try {
      expect(checked(await client.from("profiles").select().eq("id", other.id))).toEqual([]);
      expect(checked(await client.from("dtr_entries").select().eq("user_id", other.id))).toEqual(
        [],
      );
      expect(
        checked(
          await client.from("profiles").update({ full_name: "Forged" }).eq("id", other.id).select(),
        ),
      ).toEqual([]);
      expect(
        (await client.from("profiles").update({ is_admin: true }).eq("id", user.id)).error,
      ).toBeTruthy();
    } finally {
      await client.auth.signOut();
    }
  });
for (const type of ["ojt", "processing"])
  test(`${type} rewards only saved checkout credit and supports mobile milestones`, async ({
    page,
  }, testInfo) => {
    const user = users.find((u) => u.type === type)!;
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());
    checked(
      await local.admin.from("dtr_entries").insert({
        user_id: user.id,
        entry_date: date,
        check_in: `${date}T00:00:00+08:00`,
        break_out: `${date}T00:00:01+08:00`,
        break_in: `${date}T00:00:02+08:00`,
      }),
    );
    try {
      await login(page, user);
      const card = page.getByRole("region", {
        name: type === "ojt" ? "OJT progress" : "Processing progress",
        exact: true,
      });
      await expect(card.getByRole("list", { name: "Progress milestones" })).toBeVisible();
      await expect(card.getByRole("status")).toBeEmpty();
      await page.route("**/rest/v1/rpc/dtr_punch", (route) =>
        route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ message: "Test save failure" }),
        }),
      );
      await page.getByRole("button", { name: "Check Out now", exact: true }).click();
      await expect(page.getByText(/Attendance was not saved/)).toBeVisible();
      await expect(page.getByTestId("checkout-celebration")).toHaveCount(0);
      await expect(card.getByRole("status")).toBeEmpty();
      await page.unroute("**/rest/v1/rpc/dtr_punch");
      await page.getByRole("button", { name: "Check Out now", exact: true }).click();
      await expect(card.getByRole("status")).toContainText("Checkout saved.");
      await expect(page.getByTestId("checkout-celebration")).toBeVisible();
      await expect(page.locator(".checkout-tick")).toHaveCount(1);
      await expect(card.getByRole("status")).toContainText(
        type === "ojt" ? "credited hours" : "+1 completed workday",
      );
      await card.screenshot({ path: testInfo.outputPath(`${type}-progress-desktop.png`) });
      await page.setViewportSize({ width: 375, height: 812 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await expect(page.locator(".checkout-static-sparkle")).toBeVisible();
      await expect(page.locator(".checkout-confetti").first()).toBeHidden();
      await card.screenshot({ path: testInfo.outputPath(`${type}-progress-mobile.png`) });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.reload();
      await expect(page.getByTestId("checkout-celebration")).toHaveCount(0);
      await expect(card.getByRole("list", { name: "Progress milestones" })).toBeVisible();
      await expect(card.getByRole("status")).toBeEmpty();
    } finally {
      checked(
        await local.admin
          .from("dtr_entries")
          .delete()
          .eq("user_id", user.id)
          .eq("entry_date", date),
      );
    }
  });

for (const type of types)
  test(`${type} calendar shows saved attendance, details, empty dates and leap months`, async ({
    page,
  }, testInfo) => {
    await login(
      page,
      users.find((u) => u.type === type)!,
    );
    await page.getByLabel("Select year to view/download", { exact: true }).selectOption("2000");
    await page.getByLabel("Select month to view/download", { exact: true }).selectOption("0");
    const calendar = page.getByRole("region", { name: "Attendance calendar", exact: true });
    const complete = calendar.getByRole("button", {
      name: "1 January 2000: Complete",
      exact: true,
    });
    await expect(calendar.getByRole("button")).toHaveCount(31);
    await complete.focus();
    await page.keyboard.press("Enter");
    await expect(complete).toHaveAttribute("aria-pressed", "true");
    await expect(calendar).toContainText("Credited hours: 8.00 hrs");
    await calendar.getByRole("button", { name: "2 January 2000: Incomplete", exact: true }).click();
    await expect(calendar).toContainText("Not recorded");
    await expect(calendar).toContainText("Credited hours: 0.00 hrs");
    await calendar.getByRole("button", { name: "3 January 2000: No record", exact: true }).click();
    await expect(calendar).toContainText("This is not an absence or leave classification.");
    if (type === "ojt") {
      await calendar.screenshot({ path: testInfo.outputPath("calendar-desktop.png") });
      await page.setViewportSize({ width: 375, height: 812 });
      await calendar.screenshot({ path: testInfo.outputPath("calendar-mobile.png") });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await page.getByLabel("Select month to view/download", { exact: true }).selectOption("1");
    await expect(calendar.getByRole("button")).toHaveCount(29);
    await expect(calendar.getByRole("button", { pressed: true })).toHaveCount(0);
    await expect(
      calendar.getByRole("button", { name: "29 February 2000: No record", exact: true }),
    ).toBeVisible();
  });

test("account-type filter combines with search and restores all categories", async ({ page }) => {
  await login(
    page,
    users.find((u) => u.type === "admin")!,
  );
  const panel = page.getByRole("region", { name: "Account list", exact: true });
  const filter = panel.getByLabel("Filter accounts by type");
  const search = panel.getByLabel("Search accounts");
  await expect(page.getByRole("tab", { name: "Accounts", exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("region", { name: "Attendance reports", exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("region", { name: "Chief approval settings", exact: true }),
  ).toHaveCount(0);
  await expect(filter).toHaveValue("all");
  for (const type of types) {
    await filter.selectOption(type);
    for (const user of users.filter((u) => u.type !== "admin")) {
      const button = panel.getByRole("button", { name: new RegExp(user.name) });
      if (user.type === type) await expect(button).toBeVisible();
      else await expect(button).toHaveCount(0);
    }
    const user = users.find((u) => u.type === type)!;
    await search.fill(user.name);
    await expect(panel.getByRole("button")).toHaveCount(1);
    await panel.getByRole("button").click();
    await expect(page.getByRole("region", { name: "Account profile" })).toContainText(user.name);
    if (type === "ojt") {
      await page.getByRole("tab", { name: "Accounts", exact: true }).focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab", { name: "Reports", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await expect(panel).toBeHidden();
      await expect(
        page.getByRole("region", { name: "Attendance reports", exact: true }),
      ).toBeVisible();
      await page
        .getByRole("tabpanel", { name: "Reports", exact: true })
        .screenshot({ path: test.info().outputPath("reports-tab-desktop.png") });
      await page.keyboard.press("ArrowRight");
      await expect(
        page.getByRole("region", { name: "Chief approval settings", exact: true }),
      ).toBeVisible();
      await page.setViewportSize({ width: 375, height: 812 });
      await page
        .getByRole("tablist", { name: "Administrator sections", exact: true })
        .screenshot({ path: test.info().outputPath("admin-tabs-mobile.png") });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await page.getByRole("tab", { name: "Accounts", exact: true }).click();
      await expect(filter).toHaveValue("ojt");
      await expect(search).toHaveValue(user.name);
      await expect(page.getByRole("region", { name: "Account profile" })).toContainText(user.name);
    }
    await search.fill("no-matching-account-" + randomUUID());
    await expect(panel.getByText("No accounts found.", { exact: true })).toBeVisible();
    await search.clear();
  }
  await filter.selectOption("all");
  for (const user of users)
    await expect(panel.getByRole("button", { name: new RegExp(user.name) })).toBeVisible();
});

test("admin summaries agree for all categories and incomplete employee values are explicit", async ({
  page,
}) => {
  const regular = users.find((u) => u.type === "regular_employee")!;
  checked(await local.admin.from("profiles").update({ ojt_title: null }).eq("id", regular.id));
  await login(
    page,
    users.find((u) => u.type === "admin")!,
  );
  for (const type of types) {
    const user = users.find((u) => u.type === type)!;
    await page.getByRole("button", { name: new RegExp(user.name) }).click();
    const profile = page.getByRole("region", { name: "Account profile" });
    await expect(profile).toContainText(user.name);
    if (type === "ojt" || type === "processing") {
      await expect(page.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        type === "ojt" ? "50" : "25",
      );
    } else {
      await expect(page.getByRole("region", { name: "Attendance summary" })).toContainText(
        "8.00 hrs",
      );
      await expect(page.getByRole("progressbar")).toHaveCount(0);
    }
    if (type === "regular_employee") await expect(profile).toContainText("Not provided");
  }
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, regular);
  await expect(page.getByRole("region", { name: "Account profile" })).toContainText("Not provided");
});
