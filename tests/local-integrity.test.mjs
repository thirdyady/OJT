import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { setTimeout as delay } from "node:timers/promises";
import { localSupabase, checked } from "../scripts/local-supabase.mjs";

const local = localSupabase();
const sql = postgres(local.databaseUrl, { max: 3, idle_timeout: 1 });
const metadata = {
  full_name: "Integrity Test",
  student_id: "TEST",
  company: "PSA",
  ojt_title: "Intern",
};
const fields = ["check_in", "break_out", "break_in", "check_out"];
const args = (date, row = {}, action = "check_in", undo = false) => ({
  action,
  undo,
  expected_date: date,
  expected_id: row.id ?? null,
  expected_check_in: row.check_in ?? null,
  expected_break_out: row.break_out ?? null,
  expected_break_in: row.break_in ?? null,
  expected_check_out: row.check_out ?? null,
});

async function fixture(run) {
  const users = [];
  try {
    for (const isAdmin of [false, true]) {
      const email = `${randomUUID()}@ojt.local.test`;
      const password = `Integrity!${randomUUID()}`;
      const { user } = checked(
        await local.admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: metadata,
        }),
      );
      users.push({ ...user, client: local.client() });
      checked(await local.admin.from("profiles").update({ is_admin: isAdmin }).eq("id", user.id));
      checked(await users.at(-1).client.auth.signInWithPassword({ email, password }));
    }
    const [{ today }] =
      await sql`SELECT (clock_timestamp() AT TIME ZONE 'Asia/Manila')::date::text AS today`;
    await run(users[0], users[1], today);
  } finally {
    for (const user of users) {
      await user.client.auth.signOut();
      checked(await local.admin.from("dtr_entries").delete().eq("user_id", user.id));
      checked(await local.admin.auth.admin.deleteUser(user.id));
    }
  }
}

test("trainee API cannot forge history, skip order, overwrite stale punches, or delete rows", async () => {
  await fixture(async (trainee, admin, today) => {
    const c = trainee.client;
    assert.ok(
      (
        await c.from("dtr_entries").insert({
          user_id: trainee.id,
          entry_date: "2000-01-01",
          check_in: "2000-01-01T08:00:00Z",
        })
      ).error,
    );
    assert.ok((await local.client().rpc("dtr_punch", args(today))).error);
    assert.equal((await c.rpc("dtr_punch", args("2000-01-01"))).error.code, "40001");
    assert.equal((await c.rpc("dtr_punch", args("2099-01-01"))).error.code, "40001");
    assert.ok((await c.rpc("dtr_punch", args(today, {}, "check_out"))).error);
    assert.ok((await c.rpc("dtr_punch", args(today, {}, "check_in", true))).error);
    const [{ before }] = await sql`SELECT clock_timestamp() AS before`;
    const initial = args(today);
    const simultaneous = await Promise.all([
      c.rpc("dtr_punch", initial),
      c.rpc("dtr_punch", initial),
    ]);
    assert.equal(simultaneous.filter((result) => !result.error).length, 1);
    assert.equal(simultaneous.find((result) => result.error).error.code, "40001");
    let row = simultaneous.find((result) => result.data).data;
    const [{ after }] = await sql`SELECT clock_timestamp() AS after`;
    assert.ok(
      Date.parse(row.check_in) >= before.getTime() && Date.parse(row.check_in) <= after.getTime(),
    );
    assert.equal(row.user_id, trainee.id);
    assert.equal(row.entry_date, today);
    assert.deepEqual(
      checked(
        await c
          .from("dtr_entries")
          .update({ check_out: "2099-01-01T00:00:00Z" })
          .eq("id", row.id)
          .select(),
      ),
      [],
    );
    assert.deepEqual(checked(await c.from("dtr_entries").delete().eq("id", row.id).select()), []);
    assert.ok(
      (await c.from("dtr_entries").upsert({ id: row.id, user_id: trainee.id, entry_date: today }))
        .error,
    );
    assert.equal(
      (await c.rpc("dtr_punch", args(today, { ...row, id: randomUUID() }, "break_out"))).error.code,
      "40001",
    );
    for (const action of fields.slice(1))
      row = checked(await c.rpc("dtr_punch", args(today, row, action)));
    assert.ok((await c.rpc("dtr_punch", args(today, row, "check_in", true))).error);
    for (const action of [...fields].reverse()) {
      row = checked(await c.rpc("dtr_punch", args(today, row, action, true)));
      assert.equal(row[action], null);
    }
    assert.equal(
      checked(await admin.client.from("dtr_entries").delete().eq("id", row.id).select()).length,
      1,
    );
  });
});

test("inactive existing sessions cannot use the attendance RPC; reactivation restores it", async () => {
  await fixture(async (trainee, admin, today) => {
    checked(
      await admin.client.rpc("dtr_admin_set_account_active", {
        target_user_id: trainee.id,
        target_active: false,
      }),
    );
    assert.equal((await trainee.client.rpc("dtr_punch", args(today))).error.code, "42501");
    checked(
      await admin.client.rpc("dtr_admin_set_account_active", {
        target_user_id: trainee.id,
        target_active: true,
      }),
    );
    const row = checked(await trainee.client.rpc("dtr_punch", args(today)));
    assert.equal(row.user_id, trainee.id);
  });
});

test("server rejects future persisted times and gaps instead of adding invalid punches", async () => {
  await fixture(async (trainee, _admin, today) => {
    let row = checked(
      await local.admin
        .from("dtr_entries")
        .insert({ user_id: trainee.id, entry_date: today, check_in: "2099-01-01T00:00:00Z" })
        .select()
        .single(),
    );
    assert.match(
      (await trainee.client.rpc("dtr_punch", args(today, row, "break_out"))).error.message,
      /ahead of server time/,
    );
    row = checked(
      await local.admin
        .from("dtr_entries")
        .update({ check_in: "2000-01-01T08:00:00Z", check_out: "2000-01-01T17:00:00Z" })
        .eq("id", row.id)
        .select()
        .single(),
    );
    assert.match(
      (await trainee.client.rpc("dtr_punch", args(today, row, "break_out"))).error.message,
      /in order/,
    );
  });
});

test("profile versions reject stale administrator and trainee saves without losing newer data", async () => {
  await fixture(async (trainee, admin) => {
    const old = checked(
      await trainee.client.from("profiles").select().eq("id", trainee.id).single(),
    );
    const updated = checked(
      await trainee.client
        .from("profiles")
        .update({ company: "New company" })
        .eq("id", trainee.id)
        .eq("updated_at", old.updated_at)
        .select()
        .single(),
    );
    const edit = {
      target_user_id: trainee.id,
      expected_updated_at: old.updated_at,
      new_full_name: "Corrected",
      new_student_id: "TEST",
      new_company: "PSA",
      new_ojt_title: "Intern",
      new_required_ojt_hours: 486,
    };
    assert.equal(
      (await admin.client.rpc("dtr_admin_update_trainee_profile", edit)).error.code,
      "40001",
    );
    assert.deepEqual(
      checked(
        await trainee.client
          .from("profiles")
          .update({ company: "Stale" })
          .eq("id", trainee.id)
          .eq("updated_at", old.updated_at)
          .select(),
      ),
      [],
    );
    assert.ok(
      (
        await trainee.client.rpc("dtr_admin_update_trainee_profile", {
          ...edit,
          expected_updated_at: updated.updated_at,
        })
      ).error,
    );
    assert.equal(
      checked(await admin.client.from("profiles").select("company").eq("id", trainee.id).single())
        .company,
      "New company",
    );
    const saved = checked(
      await admin.client.rpc("dtr_admin_update_trainee_profile", {
        ...edit,
        expected_updated_at: updated.updated_at,
        new_company: "New company",
      }),
    );
    assert.equal(saved.full_name, "Corrected");
    assert.equal(saved.company, "New company");
  });
});

test("public signup rejects missing or whitespace-only details atomically", async () => {
  for (const data of [
    {},
    { full_name: " \t ", student_id: " ", company: " ", ojt_title: " " },
    { full_name: "\u00a0\u2003", student_id: "\u00a0", company: "\u3000", ojt_title: "\ufeff" },
  ]) {
    const email = `${randomUUID()}@ojt.local.test`;
    const result = await local
      .client()
      .auth.signUp({ email, password: `Signup!${randomUUID()}`, options: { data } });
    assert.ok(result.error);
    assert.equal((await sql`SELECT id FROM auth.users WHERE email = ${email}`).length, 0);
  }
});

test("a punch waiting behind deactivation rechecks status after the lock releases", async () => {
  await fixture(async (trainee, _admin, today) => {
    let release;
    let acquired;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const ready = new Promise((resolve) => {
      acquired = resolve;
    });
    const holding = sql.begin(async (tx) => {
      await tx`UPDATE public.profiles SET is_active = false WHERE id = ${trainee.id}`;
      const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
      acquired(pid);
      await gate;
    });
    let pending;
    try {
      const pid = await Promise.race([
        ready,
        holding.then(() => {
          throw new Error("Lock ended early");
        }),
      ]);
      pending = trainee.client.rpc("dtr_punch", args(today)).then((result) => result);
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const [row] =
          await sql`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))) AS blocked`;
        if (row.blocked) {
          blocked = true;
          break;
        }
        await delay(50);
      }
      assert.equal(blocked, true, "punch must actually wait for the deactivation lock");
      release();
      await holding;
      assert.equal((await pending).error.code, "42501");
      assert.deepEqual(
        checked(await local.admin.from("dtr_entries").select("id").eq("user_id", trainee.id)),
        [],
      );
    } finally {
      release();
      await holding;
      if (pending) await pending;
    }
  });
});

test.after(async () => {
  await sql.end();
});
