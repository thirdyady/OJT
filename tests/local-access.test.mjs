import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { localSupabase, checked } from "../scripts/local-supabase.mjs";

test("local RLS separates trainees, permits admin attendance management, and prevents role escalation", async () => {
  const local = localSupabase();
  const users = [];
  try {
    for (const role of ["trainee", "other", "admin"]) {
      const email = `${role}-${randomUUID()}@ojt.local.test`;
      const password = `Test!${randomUUID()}`;
      const { user } = checked(
        await local.admin.auth.admin.createUser({ email, password, email_confirm: true }),
      );
      users.push({ ...user, role, password });
      checked(
        await local.admin
          .from("profiles")
          .update({ is_admin: role === "admin" })
          .eq("id", user.id),
      );
    }
    const [trainee, other, admin] = users;
    const a = local.client();
    const b = local.client();
    checked(await a.auth.signInWithPassword({ email: trainee.email, password: trainee.password }));
    checked(await b.auth.signInWithPassword({ email: admin.email, password: admin.password }));
    const entry = checked(
      await local.admin
        .from("dtr_entries")
        .insert({
          user_id: other.id,
          entry_date: "2000-01-01",
          check_in: "2000-01-01T08:00:00+08:00",
        })
        .select()
        .single(),
    );
    assert.deepEqual(checked(await a.from("dtr_entries").select().eq("id", entry.id)), []);
    assert.deepEqual(checked(await a.from("profiles").select().eq("id", other.id)), []);
    assert.deepEqual(
      checked(await a.from("dtr_entries").update({ check_in: null }).eq("id", entry.id).select()),
      [],
    );
    assert.deepEqual(checked(await a.from("dtr_entries").delete().eq("id", entry.id).select()), []);
    assert.ok((await a.from("profiles").update({ is_admin: true }).eq("id", trainee.id)).error);
    assert.ok((await a.from("profiles").upsert({ id: trainee.id, is_admin: true })).error);
    assert.ok((await a.from("profiles").update({ is_active: false }).eq("id", trainee.id)).error);
    checked(
      await a
        .from("profiles")
        .update({ full_name: "Updated trainee" })
        .eq("id", trainee.id)
        .select()
        .single(),
    );
    assert.deepEqual(
      checked(
        await a.from("profiles").update({ full_name: "Other name" }).eq("id", other.id).select(),
      ),
      [],
    );
    const own = checked(
      await a
        .from("dtr_entries")
        .insert({ user_id: trainee.id, entry_date: "2000-01-02" })
        .select()
        .single(),
    );
    assert.ok(
      (await a.from("dtr_entries").insert({ user_id: trainee.id, entry_date: "2000-01-02" })).error,
    );
    checked(
      await a
        .from("dtr_entries")
        .update({ check_in: "2000-01-02T00:00:00Z" })
        .eq("id", own.id)
        .select()
        .single(),
    );
    assert.equal(
      checked(await b.from("dtr_entries").select().eq("id", entry.id).single()).id,
      entry.id,
    );
    checked(await b.from("profiles").select().eq("id", other.id).single());
    checked(
      await b.from("dtr_entries").update({ check_in: null }).eq("id", entry.id).select().single(),
    );
    const editedProfile = checked(
      await b.rpc("dtr_admin_update_trainee_profile", {
        target_user_id: trainee.id,
        new_full_name: "Admin edited trainee",
        new_student_id: "ADMIN-EDIT-001",
        new_company: "PSA Admin Test",
        new_ojt_title: "Admin Edited Intern",
        new_required_ojt_hours: 486,
      }),
    );
    assert.deepEqual(
      {
        full_name: editedProfile.full_name,
        student_id: editedProfile.student_id,
        company: editedProfile.company,
        ojt_title: editedProfile.ojt_title,
        required_ojt_hours: editedProfile.required_ojt_hours,
        is_admin: editedProfile.is_admin,
      },
      {
        full_name: "Admin edited trainee",
        student_id: "ADMIN-EDIT-001",
        company: "PSA Admin Test",
        ojt_title: "Admin Edited Intern",
        required_ojt_hours: 486,
        is_admin: false,
      },
    );
    const updatedTarget = checked(
      await b.rpc("dtr_admin_set_required_ojt_hours", {
        target_user_id: trainee.id,
        target_hours: 486,
      }),
    );
    assert.equal(updatedTarget.required_ojt_hours, 486);
    const deactivated = checked(
      await b.rpc("dtr_admin_set_account_active", {
        target_user_id: trainee.id,
        target_active: false,
      }),
    );
    assert.equal(deactivated.is_active, false);
    assert.equal(
      checked(await a.from("profiles").select("is_active").eq("id", trainee.id).single()).is_active,
      false,
    );
    assert.equal(checked(await a.rpc("dtr_is_active")), false);
    assert.deepEqual(checked(await a.from("dtr_entries").select().eq("id", own.id)), []);
    assert.deepEqual(
      checked(await a.from("dtr_entries").update({ check_in: null }).eq("id", own.id).select()),
      [],
    );
    assert.deepEqual(
      checked(
        await a
          .from("profiles")
          .update({ full_name: "Inactive update" })
          .eq("id", trainee.id)
          .select(),
      ),
      [],
    );
    assert.ok(
      (await a.from("dtr_entries").insert({ user_id: trainee.id, entry_date: "2000-01-03" })).error,
    );
    assert.equal(
      checked(await b.from("dtr_entries").select().eq("id", own.id).single()).id,
      own.id,
    );
    const reactivated = checked(
      await b.rpc("dtr_admin_set_account_active", {
        target_user_id: trainee.id,
        target_active: true,
      }),
    );
    assert.equal(reactivated.is_active, true);
    assert.equal(checked(await a.rpc("dtr_is_active")), true);
    assert.equal(
      checked(await a.from("dtr_entries").select().eq("id", own.id).single()).id,
      own.id,
    );
    assert.ok(
      (
        await b.rpc("dtr_admin_set_account_active", {
          target_user_id: admin.id,
          target_active: false,
        })
      ).error,
    );
    assert.ok(
      (
        await a.rpc("dtr_admin_update_trainee_profile", {
          target_user_id: other.id,
          new_full_name: "Trainee cannot edit this",
          new_student_id: "NOPE",
          new_company: "Nope",
          new_ojt_title: "Nope",
          new_required_ojt_hours: 486,
        })
      ).error,
    );
    assert.ok(
      (
        await a.rpc("dtr_admin_set_required_ojt_hours", {
          target_user_id: other.id,
          target_hours: 486,
        })
      ).error,
    );
    checked(await b.from("dtr_entries").delete().eq("id", entry.id).select().single());
    await a.auth.signOut();
    await b.auth.signOut();
  } finally {
    for (const user of users) checked(await local.admin.auth.admin.deleteUser(user.id));
  }
});

test("new signup metadata creates a complete trainee profile without requiring non-null legacy fields", async () => {
  const local = localSupabase();
  const email = `signup-${randomUUID()}@ojt.local.test`;
  const password = `Test!${randomUUID()}`;
  let userId;
  try {
    const { user } = checked(
      await local.client().auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: "Metadata Test Trainee",
            student_id: "META-001",
            company: "PSA (metadata test)",
            ojt_title: "Survey Intern",
          },
        },
      }),
    );
    assert.ok(user);
    userId = user.id;

    const profile = checked(
      await local.admin
        .from("profiles")
        .select("full_name, student_id, company, ojt_title, is_admin")
        .eq("id", userId)
        .single(),
    );
    assert.deepEqual(profile, {
      full_name: "Metadata Test Trainee",
      student_id: "META-001",
      company: "PSA (metadata test)",
      ojt_title: "Survey Intern",
      is_admin: false,
    });
  } finally {
    if (userId) checked(await local.admin.auth.admin.deleteUser(userId));
  }
});
