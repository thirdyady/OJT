import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { localSupabase, checked } from "../scripts/local-supabase.mjs";

const local = localSupabase();
const adminClient = local.client();
let adminId;
const details = {
  full_name: "Confirmation visibility",
  student_id: "TEST",
  company: "PSA",
  ojt_title: "Analyst",
};

before(async () => {
  const email = `${randomUUID()}@ojt.local.test`,
    password = `Test!${randomUUID()}`;
  const { user } = checked(
    await local.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: details,
    }),
  );
  adminId = user.id;
  checked(await local.admin.from("profiles").update({ is_admin: true }).eq("id", adminId));
  checked(await adminClient.auth.signInWithPassword({ email, password }));
});
after(async () => {
  await adminClient.auth.signOut();
  if (adminId) checked(await local.admin.auth.admin.deleteUser(adminId));
});

for (const type of ["ojt", "job_order", "processing", "regular_employee"]) {
  test(`${type}: pending signup stays hidden until Auth confirmation; profile/history survive`, async () => {
    const client = local.client();
    const email = `${randomUUID()}@ojt.local.test`,
      password = `Test!${randomUUID()}`;
    let id;
    try {
      const signup = checked(
        await client.auth.signUp({
          email,
          password,
          options: {
            data: {
              ...details,
              account_type: type,
              required_workdays: type === "processing" ? 20 : null,
              email_confirmed_at: new Date().toISOString(),
              email_verified: true,
              is_active: true,
            },
          },
        }),
      );
      id = signup.user.id;
      assert.equal(signup.session, null);
      assert.ok((await client.auth.signInWithPassword({ email, password })).error);
      const profile = checked(await local.admin.from("profiles").select().eq("id", id).single());
      checked(
        await local.admin
          .from("dtr_entries")
          .insert({ user_id: id, entry_date: "2000-01-01", check_in: "2000-01-01T08:00:00+08:00" }),
      );
      const history = checked(await local.admin.from("dtr_entries").select().eq("user_id", id));
      assert.deepEqual(checked(await adminClient.from("profiles").select().eq("id", id)), []);
      assert.equal(
        checked(await adminClient.rpc("dtr_admin_can_view_profile", { target_user_id: id })),
        false,
      );

      checked(await local.admin.auth.admin.updateUserById(id, { email_confirm: true }));
      assert.deepEqual(
        checked(await adminClient.from("profiles").select().eq("id", id).single()),
        profile,
      );
      assert.deepEqual(
        checked(await local.admin.from("dtr_entries").select().eq("user_id", id)),
        history,
      );
      checked(await client.auth.signInWithPassword({ email, password }));
      assert.equal(
        checked(await client.from("profiles").select("id").eq("id", id).single()).id,
        id,
      );
      assert.deepEqual(checked(await client.from("profiles").select("id").eq("id", adminId)), []);
      assert.equal(
        checked(await client.rpc("dtr_admin_can_view_profile", { target_user_id: adminId })),
        false,
      );

      checked(await local.admin.from("profiles").update({ is_active: false }).eq("id", id));
      assert.equal(
        checked(await adminClient.from("profiles").select("is_active").eq("id", id).single())
          .is_active,
        false,
      );
    } finally {
      await client.auth.signOut();
      if (id) {
        checked(await local.admin.from("dtr_entries").delete().eq("user_id", id));
        checked(await local.admin.auth.admin.deleteUser(id));
      }
    }
  });
}

test("confirmed admin provisioning stays visible; anonymous and inactive callers cannot use the helper", async () => {
  assert.equal(
    checked(await adminClient.rpc("dtr_admin_can_view_profile", { target_user_id: adminId })),
    true,
  );
  assert.ok(
    (await local.client().rpc("dtr_admin_can_view_profile", { target_user_id: adminId })).error,
  );
  checked(await local.admin.from("profiles").update({ is_active: false }).eq("id", adminId));
  try {
    assert.equal(
      checked(await adminClient.rpc("dtr_admin_can_view_profile", { target_user_id: adminId })),
      false,
    );
    // Self-read is retained so the application can detect deactivation.
    assert.equal(
      checked(await adminClient.from("profiles").select("id").eq("id", adminId).single()).id,
      adminId,
    );
  } finally {
    checked(await local.admin.from("profiles").update({ is_active: true }).eq("id", adminId));
  }
});
