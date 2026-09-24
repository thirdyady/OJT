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
