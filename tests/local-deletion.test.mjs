import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import postgres from "postgres";
import { localSupabase, checked } from "../scripts/local-supabase.mjs";

const local = localSupabase();
const sql = postgres(local.databaseUrl, { max: 3, idle_timeout: 1 });
const rpc = (actor, target, confirmation = target) =>
  local.admin.rpc("dtr_delete_unused_trainee", {
    actor_user_id: actor,
    target_user_id: target,
    confirmation,
  });

async function fixture(run) {
  const users = [];
  const password = `Deletion!${randomUUID()}`;
  try {
    for (const isAdmin of [true, false]) {
      const email = `${randomUUID()}@ojt.local.test`;
      const { user } = checked(
        await local.admin.auth.admin.createUser({ email, password, email_confirm: true }),
      );
      users.push({ id: user.id, email, password });
      checked(await local.admin.from("profiles").update({ is_admin: isAdmin }).eq("id", user.id));
    }
    await run(...users);
  } finally {
    for (const user of users) {
      checked(await local.admin.from("dtr_entries").delete().eq("user_id", user.id));
      const existing = checked(await local.admin.from("profiles").select("id").eq("id", user.id));
      if (existing.length) checked(await local.admin.auth.admin.deleteUser(user.id));
    }
  }
}

test("deletion RPC requires the server, a current active admin, a trainee and exact confirmation", async () => {
  await fixture(async (admin, trainee) => {
    const args = { actor_user_id: admin.id, target_user_id: trainee.id, confirmation: trainee.id };
    assert.ok((await local.client().rpc("dtr_delete_unused_trainee", args)).error);
    const browser = local.client();
    checked(await browser.auth.signInWithPassword(trainee));
    assert.ok(
      (await browser.rpc("dtr_delete_unused_trainee", args)).error,
      "cannot forge actor ID",
    );
    await browser.auth.signOut();
    checked(await browser.auth.signInWithPassword(admin));
    assert.ok(
      (await browser.rpc("dtr_delete_unused_trainee", args)).error,
      "even admins must use the server",
    );
    await browser.auth.signOut();
    assert.match((await rpc(admin.id, admin.id)).error.message, /own account/);
    assert.match((await rpc(admin.id, trainee.id, randomUUID())).error.message, /exact account ID/);
    assert.match((await rpc(trainee.id, admin.id)).error.message, /active DTR administrators/);
    checked(await local.admin.from("profiles").update({ is_active: false }).eq("id", admin.id));
    assert.match((await rpc(admin.id, trainee.id)).error.message, /active DTR administrators/);
    checked(await local.admin.from("profiles").update({ is_active: true }).eq("id", admin.id));
    checked(await local.admin.from("profiles").update({ is_admin: true }).eq("id", trainee.id));
    assert.match((await rpc(admin.id, trainee.id)).error.message, /Administrator accounts/);
    assert.equal(
      checked(await local.admin.from("profiles").select("id").in("id", [admin.id, trainee.id]))
        .length,
      2,
    );
  });
});

test("any DTR row blocks RPC and direct Auth deletion, preserving profile and attendance", async () => {
  await fixture(async (admin, trainee) => {
    const entry = checked(
      await local.admin
        .from("dtr_entries")
        .insert({ user_id: trainee.id, entry_date: "2000-01-01" })
        .select()
        .single(),
    );
    assert.match((await rpc(admin.id, trainee.id)).error.message, /DTR history/);
    assert.ok((await local.admin.auth.admin.deleteUser(trainee.id)).error);
    assert.equal(
      checked(await local.admin.from("profiles").select("id").eq("id", trainee.id).single()).id,
      trainee.id,
    );
    assert.equal(
      checked(await local.admin.from("dtr_entries").select("id").eq("id", entry.id).single()).id,
      entry.id,
    );
  });
});

test("unused account deletion removes Auth, profile and sessions and blocks the existing login", async () => {
  await fixture(async (admin, trainee) => {
    const client = local.client();
    const session = checked(await client.auth.signInWithPassword(trainee)).session;
    checked(await local.admin.from("profiles").update({ is_active: false }).eq("id", trainee.id));
    assert.equal(checked(await rpc(admin.id, trainee.id)), trainee.id);
    assert.deepEqual(
      checked(await local.admin.from("profiles").select("id").eq("id", trainee.id)),
      [],
    );
    const rows = await sql`SELECT id FROM auth.sessions WHERE user_id = ${trainee.id}`;
    assert.equal(rows.length, 0);
    assert.ok((await local.client().auth.signInWithPassword(trainee)).error);
    assert.ok(
      (await local.client().auth.refreshSession({ refresh_token: session.refresh_token })).error,
    );
    assert.ok(
      (await client.from("dtr_entries").insert({ user_id: trainee.id, entry_date: "2000-01-02" }))
        .error,
    );
    assert.match((await rpc(admin.id, trainee.id)).error.message, /not found/);
    await client.auth.signOut();
  });
});

function gate() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

async function waitForBlocked(pid) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [row] = await sql`SELECT EXISTS (
      SELECT 1 FROM pg_stat_activity WHERE ${pid} = ANY(pg_blocking_pids(pid))
    ) AS blocked`;
    if (row.blocked) return;
    await delay(50);
  }
  throw new Error("Expected a real blocked database transaction, not a timing-only race test");
}

for (const insertFirst of [true, false]) {
  test(`concurrent attendance and deletion: ${insertFirst ? "insert commits first, deletion fails" : "deletion commits first, insert fails"}`, async () => {
    await fixture(async (admin, trainee) => {
      const acquired = gate();
      const release = gate();
      const holder = postgres(local.databaseUrl, { max: 1 });
      let competing;
      const transaction = holder.begin(async (tx) => {
        await tx`SET LOCAL statement_timeout = '10s'`;
        const [{ pid }] = await tx`SELECT pg_backend_pid() AS pid`;
        if (insertFirst) {
          await tx`INSERT INTO public.dtr_entries (user_id, entry_date) VALUES (${trainee.id}, '2000-01-03')`;
        } else {
          await tx`SELECT set_config('request.jwt.claim.role', 'service_role', true)`;
          await tx`SELECT public.dtr_delete_unused_trainee(${admin.id}::uuid, ${trainee.id}::uuid, ${trainee.id})`;
        }
        acquired.resolve(pid);
        await release.promise;
      });
      // Surface transaction setup failures instead of leaving the test waiting.
      const ready = Promise.race([
        acquired.promise,
        transaction.then(() => {
          throw new Error("Transaction ended before acquiring lock");
        }),
      ]);
      try {
        const pid = await ready;
        competing = insertFirst
          ? rpc(admin.id, trainee.id).then((result) => result)
          : local.admin
              .from("dtr_entries")
              .insert({ user_id: trainee.id, entry_date: "2000-01-03" })
              .then((result) => result);
        await waitForBlocked(pid);
        release.resolve();
        await transaction;
        assert.ok((await competing).error);
        const entries = checked(
          await local.admin.from("dtr_entries").select("id").eq("user_id", trainee.id),
        );
        const profiles = checked(
          await local.admin.from("profiles").select("id").eq("id", trainee.id),
        );
        assert.equal(entries.length, insertFirst ? 1 : 0);
        assert.equal(profiles.length, insertFirst ? 1 : 0);
      } finally {
        release.resolve();
        await transaction.catch(() => {});
        if (competing) await competing;
        await holder.end();
      }
    });
  });
}

test.after(async () => {
  await sql.end();
});
