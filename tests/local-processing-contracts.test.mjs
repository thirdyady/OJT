import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { localSupabase, checked } from "../scripts/local-supabase.mjs";
import { accountProgress } from "../src/lib/account-progress.mjs";
const local = localSupabase(),
  sql = postgres(local.databaseUrl, { max: 1 }),
  users = [];
async function create(type = "processing", admin = false) {
  const email = randomUUID() + "@example.test",
    password = "Contract!" + randomUUID();
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
        full_name: "Contract fixture",
        company: "PSA",
        ojt_title: "Staff",
        student_id: "T",
      },
    }),
  );
  const client = local.client();
  users.push(user.id);
  if (admin)
    checked(await local.admin.from("profiles").update({ is_admin: true }).eq("id", user.id));
  checked(await client.auth.signInWithPassword({ email, password }));
  return { id: user.id, client };
}
async function contracts(u) {
  return checked(
    await local.admin
      .from("processing_contracts")
      .select("*")
      .eq("user_id", u.id)
      .order("start_date"),
  );
}
const call = (actor, u, c, extra = {}) =>
  actor.client.rpc("dtr_save_processing_contract", {
    target_user_id: u.id,
    contract_id: c.id,
    expected_revision: c.revision,
    expected_latest_id: c.id,
    starts: c.start_date,
    ends: c.end_date,
    days: 80,
    correction_reason: "Contract amended",
    operation_id: randomUUID(),
    ...extra,
  });
after(async () => {
  for (const id of users) {
    checked(await local.admin.from("processing_contract_audit").delete().eq("user_id", id));
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", id));
    checked(await local.admin.auth.admin.deleteUser(id));
  }
  await sql.end();
});
test("migration backfills Processing only without changing profiles or attendance", async () => {
  const u = await create();
  const rollback = new Error("rehearsal rollback");
  await assert.rejects(
    sql.begin(async (tx) => {
      await tx.unsafe(
        "DROP TRIGGER initialize_processing_contract ON public.profiles; DROP TABLE public.processing_contract_audit,public.processing_contracts; DROP FUNCTION public.dtr_initialize_processing_contract(),public.dtr_validate_processing_contract(),public.dtr_save_processing_contract(uuid,uuid,integer,date,date,integer,text,uuid,uuid);",
      );
      const snapshots = await tx`select id,to_jsonb(p) data from public.profiles p order by id`;
      const entries = await tx`select id,to_jsonb(d) data from public.dtr_entries d order by id`;
      await tx.unsafe(
        readFileSync("supabase/migrations/20261028000000_processing_contracts.sql", "utf8")
          .replace(/^BEGIN;/, "")
          .replace(/COMMIT;\s*$/, ""),
      );
      assert.deepEqual(
        await tx`select id,to_jsonb(p) data from public.profiles p order by id`,
        snapshots,
      );
      assert.deepEqual(
        await tx`select id,to_jsonb(d) data from public.dtr_entries d order by id`,
        entries,
      );
      const [c] =
        await tx`select start_date::text,required_workdays from public.processing_contracts where user_id=${u.id}`;
      assert.equal(c.start_date, "0001-01-01");
      assert.equal(c.required_workdays, 20);
      assert.equal(
        (
          await tx`select count(*)::int n from public.processing_contracts c join public.profiles p on p.id=c.user_id where p.account_type<>'processing'`
        )[0].n,
        0,
      );
      throw rollback;
    }),
    (e) => e === rollback,
  );
});
test("RLS isolates contracts and ordinary, inactive and anonymous callers cannot edit", async () => {
  const u = await create(),
    other = await create(),
    admin = await create("ojt", true),
    c = (await contracts(u))[0];
  assert.equal(checked(await u.client.from("processing_contracts").select("*")).length, 1);
  assert.deepEqual(
    checked(await other.client.from("processing_contracts").select("*").eq("user_id", u.id)),
    [],
  );
  assert.ok((await call(u, u, c)).error);
  assert.ok((await local.client().rpc("dtr_save_processing_contract", {})).error);
  assert.ok(
    (await u.client.from("processing_contracts").update({ required_workdays: 1 }).eq("id", c.id))
      .error,
  );
  assert.ok(
    (await u.client.from("profiles").update({ required_workdays: 1 }).eq("id", u.id)).error,
  );
  checked(await local.admin.from("profiles").update({ is_active: false }).eq("id", admin.id));
  assert.ok((await call(admin, u, c)).error);
  assert.deepEqual(checked(await u.client.from("processing_contract_audit").select("*")), []);
});
test("target edits are audited, idempotent and reject stale revisions or changed retry payloads", async () => {
  const u = await create(),
    a = await create("ojt", true),
    c = (await contracts(u))[0],
    operation_id = randomUUID();
  checked(await call(a, u, c, { operation_id }));
  checked(await call(a, u, c, { operation_id }));
  assert.ok((await call(a, u, c)).error);
  assert.ok((await call(a, u, c, { operation_id, days: 81 })).error);
  const audit = checked(
    await a.client.from("processing_contract_audit").select("*").eq("user_id", u.id),
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].old_values[0].required_workdays, 20);
  assert.equal(audit[0].new_values[0].required_workdays, 80);
  assert.equal(audit[0].actor_id, a.id);
  assert.ok(
    (await local.admin.auth.admin.deleteUser(u.id)).error,
    "Audited contracts protect account deletion",
  );
});
test("renewal separates progress and preserves DTR; overlap and invalid values rejected", async () => {
  const u = await create(),
    a = await create("ojt", true);
  let c = (await contracts(u))[0];
  checked(await call(a, u, c, { starts: "2000-01-01", days: 20 }));
  c = (await contracts(u))[0];
  const entries = ["2000-01-01", "2000-02-01"].map((d) => ({
    user_id: u.id,
    entry_date: d,
    check_in: d + "T08:00:00+08:00",
    check_out: d + "T16:00:00+08:00",
  }));
  checked(await local.admin.from("dtr_entries").insert(entries));
  checked(await call(a, u, c, { contract_id: null, starts: "2000-02-01", ends: "2000-12-31" }));
  const periods = await contracts(u);
  assert.equal(periods.length, 2);
  assert.equal(periods[0].end_date, "2000-01-31");
  const rows = checked(await local.admin.from("dtr_entries").select("*").eq("user_id", u.id));
  assert.equal(rows.length, 2);
  const progress = accountProgress(
    { account_type: "processing", required_workdays: 20, processing_contracts: periods },
    rows,
  );
  assert.equal(progress.credited, 1);
  assert.equal(progress.target, 80);
  assert.ok((await call(a, u, periods[0], { ends: "2000-02-01" })).error);
  for (const extra of [
    { days: 0 },
    { days: 1.5 },
    { correction_reason: "" },
    { ends: "1999-01-01" },
  ])
    assert.ok((await call(a, u, periods[0], extra)).error);
  const ojt = await create("ojt");
  assert.ok((await call(a, ojt, periods[0])).error);
});
test("concurrent edits have exactly one winner and one audit event", async () => {
  const u = await create(),
    a = await create("ojt", true),
    c = (await contracts(u))[0];
  const results = await Promise.all([call(a, u, c, { days: 30 }), call(a, u, c, { days: 40 })]);
  assert.equal(results.filter((r) => !r.error).length, 1);
  assert.equal(
    checked(await local.admin.from("processing_contract_audit").select("*").eq("user_id", u.id))
      .length,
    1,
  );
});
test("database constraints reject overlapping or wrong-account trusted inserts", async () => {
  const u = await create(),
    ojt = await create("ojt"),
    c = (await contracts(u))[0];
  assert.ok(
    (
      await local.admin
        .from("processing_contracts")
        .insert({ user_id: u.id, start_date: c.start_date, required_workdays: 2 })
    ).error,
  );
  assert.ok(
    (
      await local.admin
        .from("processing_contracts")
        .insert({ user_id: ojt.id, start_date: c.start_date, required_workdays: 2 })
    ).error,
  );
});

test("stale renewal cannot append another period just because both revisions are one", async () => {
  const u = await create(),
    a = await create("ojt", true),
    c = (await contracts(u))[0];
  checked(await call(a, u, c, { contract_id: null, starts: "2990-01-01", ends: "2990-12-31" }));
  assert.ok(
    (await call(a, u, c, { contract_id: null, starts: "2991-01-01", ends: "2991-12-31" })).error,
  );
  assert.equal((await contracts(u)).length, 2);
});

test("failed audit insertion rolls back target changes", async () => {
  const u = await create(),
    a = await create("ojt", true),
    c = (await contracts(u))[0];
  await sql.unsafe(`CREATE FUNCTION public.contract_test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END; $$;
    CREATE TRIGGER contract_test_reject_audit BEFORE INSERT ON public.processing_contract_audit FOR EACH ROW WHEN (NEW.user_id = '${u.id}'::uuid) EXECUTE FUNCTION public.contract_test_reject_audit();`);
  try {
    assert.ok((await call(a, u, c)).error);
    assert.deepEqual((await contracts(u))[0], c);
  } finally {
    await sql.unsafe(
      "DROP TRIGGER contract_test_reject_audit ON public.processing_contract_audit; DROP FUNCTION public.contract_test_reject_audit();",
    );
  }
});
