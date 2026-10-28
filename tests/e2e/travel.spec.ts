import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { setupChief, approvePopup } from "../chief-fixture.mjs";
import { readFile } from "node:fs/promises";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";
const local = localSupabase(),
  password = `Travel!${randomUUID()}`;
const users: { id: string; email: string; type: string }[] = [];
test.beforeAll(async () => {
  for (const type of ["ojt", "processing", "job_order", "regular_employee"]) {
    const email = `${randomUUID()}@example.test`;
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
          full_name: `Travel ${type}`,
          student_id: "TEST",
          company: "PSA",
          ojt_title: "Staff",
        },
      }),
    );
    users.push({ id: user.id, email, type });
  }
});
test.afterAll(async () => {
  for (const u of users) {
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", u.id));
    checked(await local.admin.auth.admin.deleteUser(u.id));
  }
});
for (const type of ["ojt", "processing", "job_order", "regular_employee"])
  test(`${type}: travel eligibility, persistence and Remarks output`, async ({ page }) => {
    const u = users.find((u) => u.type === type)!;
    await page.goto("/auth");
    await page.locator('body[data-app-hydrated="true"]').waitFor();
    await page.getByLabel("Email or username", { exact: true }).fill(u.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Check In now", exact: true })).toBeVisible();
    if (["job_order", "regular_employee"].includes(type)) {
      await page.getByRole("button", { name: "Travel Out", exact: true }).click();
      const modal = page.getByRole("alertdialog");
      await expect(modal).toBeVisible();
      await modal
        .getByLabel("Credited hours", { exact: true })
        .selectOption(type === "job_order" ? "8" : "10");
      await modal.getByLabel("Place of travel", { exact: true }).fill("Bukidnon");
      await expect(modal.getByLabel("Place of travel", { exact: true })).toHaveAttribute(
        "maxlength",
        "15",
      );
      await modal.getByLabel("Reason for travel", { exact: true }).fill("Private meeting details");
      // Failed save must preserve inputs and credit nothing.
      await page.route(
        "**/rest/v1/rpc/dtr_travel_out",
        (route) =>
          route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ message: "Temporary service failure" }),
          }),
        { times: 1 },
      );
      await modal.getByRole("button", { name: "Confirm Travel Out" }).click();
      await expect(modal.getByRole("alert")).toContainText("Temporary service failure");
      await expect(modal.getByLabel("Place of travel", { exact: true })).toHaveValue("Bukidnon");
      await modal.getByRole("button", { name: "Confirm Travel Out" }).click();
      await expect(modal).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Travel Out", exact: true })).toBeDisabled();
      await expect(page.getByRole("list", { name: "Attendance steps" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Check In now", exact: true })).toHaveCount(0);
      await page.reload();
      await expect(
        page.getByRole("region", { name: "Today's attendance", exact: true }),
      ).toContainText("Private meeting details");
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({ path: `test-results/travel-${type}.png`, fullPage: true });
    } else
      await expect(page.getByRole("button", { name: "Travel Out", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Print DTR", exact: true }).click();
    const print = page.frameLocator("iframe");
    const printHtml = await page.locator("iframe").getAttribute("srcdoc");
    await expect(print.getByRole("columnheader", { name: "Remarks" }).first()).toHaveText(
      "Remarks",
    );
    if (["job_order", "regular_employee"].includes(type)) {
      await expect(
        print.locator("tbody tr td:last-child").filter({ hasText: /^Travel$/ }),
      ).toHaveCount(2);
      await expect(print.locator(".total-line").first()).toContainText(
        type === "job_order" ? "8.00 hrs" : "10.00 hrs",
      );
    } else
      await expect(
        print.locator("tbody tr td:last-child").filter({ hasText: /^Travel$/ }),
      ).toHaveCount(0);
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Word", exact: true }).click();
    const html = await readFile((await (await download).path())!, "utf8");
    expect(html).toContain("Remarks");
    expect(html).not.toContain("Private meeting details");
    expect(html).not.toContain("Bukidnon");
    if (type === "job_order") {
      const preview = await page.context().newPage();
      await preview.setViewportSize({ width: 1100, height: 1000 });
      await preview.setContent(printHtml!);
      await preview.screenshot({ path: "test-results/travel-print.png", fullPage: true });
      await preview.setContent(html);
      await preview.screenshot({ path: "test-results/travel-word.png", fullPage: true });
      await preview.close();
    }
    if (["job_order", "regular_employee"].includes(type)) expect(html).toContain(">Travel</td>");
  });

test("administrator edits travel with Chief approval and a correction reason", async ({ page }) => {
  await setupChief();
  const email = `${randomUUID()}@example.test`;
  const { user } = checked(
    await local.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: "Travel Admin",
        student_id: "T",
        company: "PSA",
        ojt_title: "Admin",
      },
    }),
  );
  users.push({ id: user.id, email, type: "admin" });
  checked(await local.admin.from("profiles").update({ is_admin: true }).eq("id", user.id));
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByLabel("Email or username", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("button", { name: /Travel job_order/ }).click();
  await page.getByRole("button", { name: "Edit DTR", exact: true }).first().click();
  const dialog = page.getByRole("alertdialog");
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  await dialog.getByLabel("Attendance date", { exact: true }).fill(day);
  await expect(dialog.getByLabel("Attendance type", { exact: true })).toHaveValue("travel");
  await dialog.getByLabel("Travel hours", { exact: true }).selectOption("10");
  await dialog
    .getByLabel("Correction reason", { exact: true })
    .fill("Chief verified travel duration");
  await dialog.getByRole("button", { name: "Save Changes", exact: true }).click();
  await expect(page.getByText(/Travel correction:/)).toContainText("10 hours");
  await approvePopup(page);
  await expect(
    page.getByText("DTR correction saved with Chief approval.", { exact: true }),
  ).toBeVisible();
  const row = checked(
    await local.admin
      .from("dtr_entries")
      .select()
      .eq("user_id", users.find((u) => u.type === "job_order")!.id)
      .eq("entry_date", day)
      .single(),
  );
  expect(row.travel_hours).toBe(10);
});
