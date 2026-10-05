import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { localSupabase, checked } from "../scripts/local-supabase.mjs";
const local = localSupabase();
const base = {
  full_name: "Public signup test",
  student_id: "TEST",
  company: "PSA",
  ojt_title: "Administrative Officer IV",
};
test("Auth rejects a short public-signup password before creating an account", async () => {
  const client = local.client();
  const email = `${randomUUID()}@ojt.local.test`;
  let id;
  try {
    const result = await client.auth.signUp({
      email,
      password: "Short!7",
      options: { data: base },
    });
    id = result.data.user?.id;
    assert.ok(result.error, "Start local Auth with minimum_password_length = 8");
    assert.equal(id, undefined);
  } finally {
    if (id) checked(await local.admin.auth.admin.deleteUser(id));
  }
});
for (const type of ["ojt", "job_order", "processing", "regular_employee"])
  test(`public ${type} signup persists category, requires email confirmation and cannot escalate`, async () => {
    const client = local.client(),
      email = `${randomUUID()}@ojt.local.test`,
      password = `Signup!${randomUUID()}`;
    let id;
    try {
      const result = checked(
        await client.auth.signUp({
          email,
          password,
          options: {
            data: {
              ...base,
              account_type: type,
              student_id: type === "ojt" ? "TEST" : null,
              required_workdays: type === "processing" ? 20 : null,
              is_admin: true,
              role: "admin",
              dtr_account_type: "admin",
            },
          },
        }),
      );
      id = result.user.id;
      assert.equal(result.session, null);
      assert.ok(!result.user.email_confirmed_at);
      let row = checked(await local.admin.from("profiles").select().eq("id", id).single());
      assert.equal(row.account_type, type);
      assert.equal(row.is_admin, false);
      assert.equal(row.required_workdays, type === "processing" ? 20 : null);
      assert.equal(row.ojt_title, base.ojt_title);
      checked(await local.admin.auth.admin.updateUserById(id, { email_confirm: true }));
      checked(await client.auth.signInWithPassword({ email, password }));
      checked(
        await client.auth.updateUser({
          data: {
            account_type: type === "ojt" ? "regular_employee" : "ojt",
            is_admin: true,
            required_workdays: 999,
          },
        }),
      );
      row = checked(await local.admin.from("profiles").select().eq("id", id).single());
      assert.equal(row.account_type, type);
      assert.equal(row.is_admin, false);
      assert.ok((await client.from("profiles").update({ is_admin: true }).eq("id", id)).error);
      assert.ok(
        (
          await client
            .from("profiles")
            .update({ account_type: type === "ojt" ? "regular_employee" : "ojt" })
            .eq("id", id)
        ).error,
      );
    } finally {
      await client.auth.signOut();
      if (id) checked(await local.admin.auth.admin.deleteUser(id));
    }
  });
test("public signup rejects invalid categories, target combinations and missing details atomically", async () => {
  for (const data of [
    { account_type: "admin" },
    { account_type: "processing" },
    { account_type: "processing", required_workdays: 0 },
    { account_type: "processing", required_workdays: 1.5 },
    { account_type: "job_order", required_workdays: 2 },
    { account_type: "regular_employee", required_ojt_hours: 8 },
    { account_type: "ojt", student_id: "  " },
    { account_type: "job_order", ojt_title: "  " },
  ]) {
    const email = `${randomUUID()}@ojt.local.test`;
    const result = await local.client().auth.signUp({
      email,
      password: `Signup!${randomUUID()}`,
      options: { data: { ...base, ...data } },
    });
    assert.ok(result.error, JSON.stringify(data));
    const { users } = checked(await local.admin.auth.admin.listUsers({ perPage: 1000 }));
    assert.ok(!users.some((u) => u.email === email));
  }
});
test("trusted provisioning metadata wins over self-selected fields", async () => {
  const { user } = checked(
    await local.admin.auth.admin.createUser({
      email: `${randomUUID()}@ojt.local.test`,
      password: `Signup!${randomUUID()}`,
      email_confirm: true,
      app_metadata: { dtr_account_type: "processing", dtr_required_workdays: 30 },
      user_metadata: {
        ...base,
        account_type: "regular_employee",
        required_workdays: -1,
        is_admin: true,
      },
    }),
  );
  try {
    const row = checked(await local.admin.from("profiles").select().eq("id", user.id).single());
    assert.equal(row.account_type, "processing");
    assert.equal(row.required_workdays, 30);
    assert.equal(row.is_admin, false);
  } finally {
    checked(await local.admin.auth.admin.deleteUser(user.id));
  }
});
