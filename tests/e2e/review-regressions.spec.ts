import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { localSupabase, checked } from "../../scripts/local-supabase.mjs";

const local = localSupabase();
const password = `Regression!${randomUUID()}`;
const users: { id: string; email: string; name: string }[] = [];

test.beforeAll(async () => {
  for (const name of ["Regression Admin", "Regression A", "Regression B"]) {
    const email = `${randomUUID()}@ojt.local.test`;
    const { user } = checked(
      await local.admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name, student_id: name, company: name, ojt_title: name },
      }),
    );
    users.push({ id: user.id, email, name });
  }
  checked(await local.admin.from("profiles").update({ is_admin: true }).eq("id", users[0].id));
  checked(
    await local.admin.from("profiles").update({ required_ojt_hours: 8 }).eq("id", users[1].id),
  );
  checked(
    await local.admin.from("dtr_entries").insert({
      user_id: users[1].id,
      entry_date: "2000-01-03",
      check_in: "2000-01-03T08:00:00+08:00",
      break_out: "2000-01-03T12:00:00+08:00",
      break_in: "2000-01-03T13:00:00+08:00",
      check_out: "2000-01-03T17:00:00+08:00",
    }),
  );
});

test.afterAll(async () => {
  for (const user of users) {
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", user.id));
    checked(await local.admin.auth.admin.deleteUser(user.id));
  }
});

async function login(page: Page, index: number) {
  await page.goto("/auth");
  await page.locator('body[data-app-hydrated="true"]').waitFor();
  await page.getByLabel("Email", { exact: true }).fill(users[index].email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}

test("a delayed profile save cannot overwrite another selected trainee's fields", async ({
  page,
}) => {
  await login(page, 0);
  await page.getByRole("button", { name: /^Regression A\b/ }).click();
  await page.getByLabel("Full Name", { exact: true }).fill("A saved name");
  let received!: () => void;
  let release!: () => void;
  const requestArrived = new Promise<void>((resolve) => {
    received = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/rest/v1/rpc/dtr_admin_update_trainee_profile", async (route) => {
    const response = await route.fetch();
    received();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "Save trainee profile", exact: true }).click();
    await requestArrived;
    await page.getByRole("button", { name: /Regression B/ }).click();
  } finally {
    release();
  }
  await expect(
    page.getByRole("button", { name: "Save trainee profile", exact: true }),
  ).toBeEnabled();
  for (const label of ["Full Name", "Student ID", "Host Company", "OJT Title"]) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue("Regression B");
  }
  await expect(page.getByText("Trainee profile saved.", { exact: true })).toHaveCount(0);
  await page.unroute("**/rest/v1/rpc/dtr_admin_update_trainee_profile");
  await page.getByRole("button", { name: "Save trainee profile", exact: true }).click();
  await expect(page.getByText("Trainee profile saved.", { exact: true })).toBeVisible();
  const profile = checked(
    await local.admin.from("profiles").select("full_name").eq("id", users[2].id).single(),
  );
  expect(profile.full_name).toBe("Regression B");
});

test("print and Word exports treat HTML in a trainee name as literal text", async ({ page }) => {
  const name =
    '<script>parent.__dtrInjected=true</script><img src=x onerror="parent.__dtrInjected=true"> & O\'Neil';
  checked(await local.admin.from("profiles").update({ full_name: name }).eq("id", users[1].id));
  try {
    await login(page, 0);
    await page.getByRole("button", { name: /O'Neil/ }).click();
    await page.getByRole("button", { name: "Print DTR", exact: true }).click();
    const frame = page.locator("iframe");
    await expect(frame).toHaveAttribute("sandbox", "allow-same-origin allow-modals");
    await expect(page.frameLocator("iframe").locator(".name-value").first()).toHaveText(name);
    await expect(page.frameLocator("iframe").locator("script, img")).toHaveCount(0);
    expect(await page.evaluate(() => "__dtrInjected" in window)).toBe(false);
    const downloadEvent = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download Word", exact: true }).click();
    const download = await downloadEvent;
    const html = await readFile((await download.path())!, "utf8");
    expect(html).toContain("&lt;script&gt;parent.__dtrInjected=true&lt;/script&gt;");
    expect(html).not.toContain("<script>parent.__dtrInjected");
    expect(html).not.toContain("<img src=x");
  } finally {
    checked(
      await local.admin.from("profiles").update({ full_name: users[1].name }).eq("id", users[1].id),
    );
  }
});

test("clearing a break keeps admin, trainee, CSV and progress hours consistent", async ({
  page,
}) => {
  await login(page, 0);
  await page.getByRole("button", { name: /^Regression A\b/ }).click();
  await page.getByLabel("Select month to view/print/download").selectOption("0");
  await page.getByLabel("Select year to view/print/download").selectOption("2000");
  await expect(page.getByText(/Total: 8.00 hrs across 1 day/)).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTitle("Clear Break In").filter({ visible: true }).click();
  await expect(page.getByText(/Total: 0.00 hrs across 1 day/)).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await login(page, 1);
  await page.getByLabel("Select month to view/download").selectOption("0");
  await page.getByLabel("Select year to view/download").selectOption("2000");
  await expect(page.getByRole("progressbar", { name: "OJT completion" })).toHaveAttribute(
    "aria-valuenow",
    "0",
  );
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const download = await downloadEvent;
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv.trim().split("\n")[1]).toMatch(/,"0\.00"$/);
});
