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
    checked(
      await a
        .from("profiles")
        .update({ full_name: "Updated trainee" })
        .eq("id", trainee.id)
        .select()
        .single(),
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
    const updatedTarget = checked(
      await b.rpc("dtr_admin_set_required_ojt_hours", {
        target_user_id: trainee.id,
        target_hours: 486,
      }),
    );
    assert.equal(updatedTarget.required_ojt_hours, 486);
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
