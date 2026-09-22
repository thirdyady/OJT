import { after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { checked, localSupabase } from "../scripts/local-supabase.mjs";

const local = localSupabase();
const sql = postgres(local.databaseUrl, { max: 1, idle_timeout: 1 });
after(() => sql.end());
const metadata = {
  full_name: "M12 Test",
  student_id: "M12",
  company: "PSA",
  ojt_title: "Intern",
};

// Run this file separately from other DB suites: the first test takes a schema
// lock and rolls back ALL its DDL/data, including on assertion failure. It
// rehearses the real migration against the actual Supabase schema, not a mock.
test("M12 backfills the pre-M12 schema without changing profiles, Auth or DTR history", async () => {
  const rollback = new Error("rollback successful migration rehearsal");
  await assert.rejects(
    sql.begin(async (tx) => {
      await tx`SET LOCAL lock_timeout = '5s'`;
      await tx`DROP TRIGGER protect_dtr_employment_fields ON public.profiles`;
      await tx`DROP FUNCTION public.protect_dtr_employment_fields()`;
      await tx`ALTER TABLE public.profiles DROP COLUMN account_type, DROP COLUMN required_workdays`;
      await tx`DROP TYPE public.account_type`;
      await tx`DROP TRIGGER on_auth_user_created ON auth.users`;
      await tx`CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
        FOR EACH ROW EXECUTE FUNCTION public.handle_new_user()`;
      // Later provisioning migrations reference account_type in the signup
      // trigger. Restore the actual pre-M12 trigger for this rollback-only test.
      const previous = readFileSync(
        new URL(
          "../supabase/migrations/20260921000001_profile_validation_and_conflicts.sql",
          import.meta.url,
        ),
        "utf8",
      );
      await tx.unsafe(
        previous.slice(
          previous.indexOf("CREATE OR REPLACE FUNCTION public.handle_new_user()"),
          previous.indexOf("-- Replace the old signature"),
        ),
      );
      const ids = [randomUUID(), randomUUID(), randomUUID()];
      for (const id of ids) {
        await tx`INSERT INTO auth.users (id, raw_user_meta_data) VALUES (${id}, ${tx.json(metadata)})`;
      }
      await tx`UPDATE public.profiles SET required_ojt_hours = 486 WHERE id = ${ids[0]}`;
      await tx`UPDATE public.profiles SET full_name = NULL, ojt_title = NULL, is_active = false WHERE id = ${ids[1]}`;
      await tx`UPDATE public.profiles SET is_admin = true WHERE id = ${ids[2]}`;
      await tx`INSERT INTO public.dtr_entries (user_id, entry_date, check_in, check_out)
        VALUES (${ids[0]}, '2020-01-02', '2020-01-02T08:00:00+08:00', '2020-01-02T17:00:00+08:00')`;
      await tx`INSERT INTO public.dtr_entries (user_id, entry_date) VALUES (${ids[1]}, '2020-01-03')`;
      const beforeProfiles = await tx`SELECT to_jsonb(p) AS row FROM public.profiles p ORDER BY id`;
      const beforeAuth = await tx`SELECT to_jsonb(u) AS row FROM auth.users u ORDER BY id`;
      const beforeDtr = await tx`SELECT to_jsonb(d) AS row FROM public.dtr_entries d ORDER BY id`;
      const migration = readFileSync(
        new URL("../supabase/migrations/20260922000000_account_types.sql", import.meta.url),
        "utf8",
      )
        .replace(/^BEGIN;\s*/, "")
        .replace(/\s*COMMIT;\s*$/, "");
      await tx.unsafe(migration);
      assert.deepEqual(
        await tx`SELECT to_jsonb(p) - 'account_type' - 'required_workdays' AS row FROM public.profiles p ORDER BY id`,
        beforeProfiles,
      );
      assert.deepEqual(
        await tx`SELECT to_jsonb(u) AS row FROM auth.users u ORDER BY id`,
        beforeAuth,
      );
      assert.deepEqual(
        await tx`SELECT to_jsonb(d) AS row FROM public.dtr_entries d ORDER BY id`,
        beforeDtr,
      );
      const [{ wrong }] = await tx`SELECT count(*)::int AS wrong FROM public.profiles
        WHERE account_type <> 'ojt' OR required_workdays IS NOT NULL`;
      assert.equal(wrong, 0);
      const [fk] = await tx`SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'public.dtr_entries'::regclass AND conname = 'dtr_entries_user_id_fkey'`;
      assert.equal(fk.confdeltype, "r");
      await assert.rejects(
        tx.savepoint((s) => s`DELETE FROM auth.users WHERE id = ${ids[0]}`),
        { code: "23503" },
      );
      throw rollback;
    }),
    (error) => error === rollback,
  );
});

async function fixture(run) {
  const users = [];
  try {
    for (const isAdmin of [false, true]) {
      const email = `${randomUUID()}@ojt.local.test`;
      const password = `M12!${randomUUID()}`;
      const { user } = checked(
        await local.admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: metadata,
        }),
      );
      const client = local.client();
      users.push({ ...user, client });
      checked(await local.admin.from("profiles").update({ is_admin: isAdmin }).eq("id", user.id));
      checked(await client.auth.signInWithPassword({ email, password }));
    }
    await run(...users);
  } finally {
    for (const user of users) {
      await user.client.auth.signOut();
      checked(await local.admin.from("dtr_entries").delete().eq("user_id", user.id));
      checked(await local.admin.auth.admin.deleteUser(user.id));
    }
  }
}

test("database constraints enforce OJT hours, Processing days, and no JO/Regular targets", async () => {
  await fixture(async (trainee) => {
    const write = (values) =>
      local.admin.from("profiles").update(values).eq("id", trainee.id).select().single();
    for (const values of [
      { account_type: "ojt", required_ojt_hours: null, required_workdays: null },
      { account_type: "ojt", required_ojt_hours: 486.5, required_workdays: null },
      { account_type: "processing", required_ojt_hours: null, required_workdays: 180 },
      { account_type: "job_order", required_ojt_hours: null, required_workdays: null },
      { account_type: "regular_employee", required_ojt_hours: null, required_workdays: null },
    ]) {
      const row = checked(await write(values));
      for (const [key, value] of Object.entries(values)) assert.equal(row[key], value);
    }
    for (const values of [
      { account_type: "unknown" },
      { account_type: null },
      { account_type: "processing", required_workdays: null },
      { account_type: "processing", required_workdays: 0 },
      { account_type: "processing", required_workdays: -1 },
      { account_type: "processing", required_workdays: 1.5 },
      { account_type: "processing", required_workdays: 10, required_ojt_hours: 10 },
      { account_type: "job_order", required_workdays: 10 },
      { account_type: "job_order", required_ojt_hours: 10 },
      { account_type: "regular_employee", required_workdays: 10 },
      { account_type: "regular_employee", required_ojt_hours: 10 },
      { account_type: "ojt", required_workdays: 10 },
      { account_type: "ojt", required_ojt_hours: 0 },
      { account_type: "ojt", required_ojt_hours: -1 },
      { account_type: "ojt", required_ojt_hours: 10001 },
      { account_type: "ojt", required_ojt_hours: "NaN" },
    ]) {
      assert.ok((await write(values)).error, JSON.stringify(values));
    }
  });
});

test("RLS and column guards reject employment/role forgery while preserving OJT self-service", async () => {
  await fixture(async (trainee, admin) => {
    for (const user of [trainee, admin]) {
      for (const values of [
        { account_type: "job_order" },
        { account_type: "processing", required_workdays: 60 },
        { required_workdays: 60 },
        { is_admin: !Boolean(user.id === admin.id) },
      ]) {
        assert.ok((await user.client.from("profiles").update(values).eq("id", user.id)).error);
        assert.ok((await user.client.from("profiles").upsert({ id: user.id, ...values })).error);
      }
    }
    assert.deepEqual(
      checked(await trainee.client.from("profiles").select().eq("id", admin.id)),
      [],
    );
    assert.deepEqual(
      checked(await local.client().from("profiles").select().eq("id", trainee.id)),
      [],
    );
    checked(
      await trainee.client
        .from("profiles")
        .update({ ojt_title: "Updated intern", company: "Updated host", required_ojt_hours: 500 })
        .eq("id", trainee.id),
    );
    checked(
      await local.admin
        .from("profiles")
        .update({ account_type: "processing", required_workdays: 90, required_ojt_hours: null })
        .eq("id", trainee.id),
    );
    for (const values of [
      { required_workdays: 1 },
      { account_type: "ojt", required_workdays: null },
      { company: "Forged employer" },
      { ojt_title: "Forged position" },
      { student_id: "Forged identifier" },
    ]) {
      assert.equal(
        (await trainee.client.from("profiles").update(values).eq("id", trainee.id)).error?.code,
        "42501",
      );
    }
    const profile = checked(
      await local.admin.from("profiles").select().eq("id", trainee.id).single(),
    );
    assert.equal(
      (
        await admin.client.rpc("dtr_admin_update_trainee_profile", {
          target_user_id: trainee.id,
          expected_updated_at: profile.updated_at,
          new_full_name: profile.full_name,
          new_student_id: profile.student_id,
          new_company: "RPC bypass",
          new_ojt_title: profile.ojt_title,
          new_required_ojt_hours: null,
        })
      ).error?.code,
      "42501",
    );
    checked(
      await local.admin
        .from("profiles")
        .update({ company: "Trusted placement" })
        .eq("id", trainee.id),
    );
    checked(await local.admin.from("profiles").update({ is_active: false }).eq("id", trainee.id));
    assert.deepEqual(
      checked(
        await trainee.client
          .from("profiles")
          .update({ full_name: "Inactive edit" })
          .eq("id", trainee.id)
          .select(),
      ),
      [],
    );
  });
});

test("public signup cannot select employment type or administrator status through metadata", async () => {
  const client = local.client();
  const { user } = checked(
    await client.auth.signUp({
      email: `${randomUUID()}@ojt.local.test`,
      password: `M12!${randomUUID()}`,
      options: {
        data: { ...metadata, account_type: "processing", required_workdays: 1, is_admin: true },
      },
    }),
  );
  assert.ok(user?.id);
  try {
    const row = checked(await local.admin.from("profiles").select().eq("id", user.id).single());
    assert.equal(row.account_type, "ojt");
    assert.equal(row.required_workdays, null);
    assert.equal(row.is_admin, false);
  } finally {
    await client.auth.signOut();
    checked(await local.admin.auth.admin.deleteUser(user.id));
  }
});
