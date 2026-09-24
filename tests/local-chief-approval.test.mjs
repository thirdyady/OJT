import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { localSupabase, checked } from "../scripts/local-supabase.mjs";
import {
  setupChief,
  prepareChief,
  approveChief,
  chiefPassword,
  recoveryCode,
} from "./chief-fixture.mjs";
const local = localSupabase();
const sql = postgres(local.databaseUrl, { max: 2 });
const users = [];
let admin,
  trainee,
  other,
  currentPassword = chiefPassword,
  currentRecovery = recoveryCode;
before(async () => {
  await setupChief();
  for (const isAdmin of [true, false, true]) {
    const email = `${randomUUID()}@ojt.local.test`,
      password = `Test!${randomUUID()}`;
    const { user } = checked(
      await local.admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: "Chief Test",
          student_id: randomUUID(),
          company: "PSA",
          ojt_title: "Intern",
        },
      }),
    );
    users.push({ ...user, client: local.client() });
    checked(await local.admin.from("profiles").update({ is_admin: isAdmin }).eq("id", user.id));
    checked(await users.at(-1).client.auth.signInWithPassword({ email, password }));
  }
  [admin, trainee, other] = users;
});
after(async () => {
  for (const u of users) {
    await u.client.auth.signOut();
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", u.id));
    checked(await local.admin.auth.admin.deleteUser(u.id));
  }
  await sql.end();
});
const values = {
  check_in: "2000-01-01T08:00:00+08:00",
  break_out: null,
  break_in: null,
  check_out: "2000-01-01T17:00:00+08:00",
};
const payload = (extra = {}) => ({
  targetUserId: trainee.id,
  date: "2000-01-01",
  expected: null,
  values,
  reason: "Approved source record correction",
  ...extra,
});
const prepare = (operation, p, actor = admin.id) => prepareChief(local, actor, operation, p);
const approve = (id, password = currentPassword, actor = admin.id, newPassword) =>
  approveChief(local, actor, id, password, newPassword);
const snapshot = (row) =>
  Object.fromEntries(
    ["id", "check_in", "break_out", "break_in", "check_out"].map((k) => [k, row[k]]),
  );

test("private secrets, audit writes, old deletion RPC and browser approval calls are inaccessible", async () => {
  for (const c of [local.client(), trainee.client, admin.client]) {
    assert.ok(
      (
        await c.rpc("dtr_chief_prepare", {
          actor_user_id: admin.id,
          request_id: randomUUID(),
          operation: "change_ssp",
          payload: {},
        })
      ).error,
    );
    assert.ok(
      (
        await c.rpc("dtr_chief_approve", {
          actor_user_id: admin.id,
          request_id: randomUUID(),
          credential: currentPassword,
        })
      ).error,
    );
    assert.ok((await c.schema("dtr_private").from("chief_secret").select()).error);
    assert.ok((await c.from("dtr_admin_audit").insert({})).error);
  }
  assert.ok(
    (
      await local.admin.rpc("dtr_delete_unused_trainee", {
        actor_user_id: admin.id,
        target_user_id: trainee.id,
        confirmation: trainee.id,
      })
    ).error,
  );
  assert.match((await prepare("edit_dtr", payload(), trainee.id)).error, /administrator/);
});
test("approval is actor-bound, expires, rejects wrong SSP, preserves original and writes one audit on retry", async () => {
  const r = await prepare("edit_dtr", payload());
  assert.ok(r.requestId);
  assert.deepEqual(
    checked(await local.admin.from("dtr_entries").select().eq("user_id", trainee.id)),
    [],
  );
  assert.match((await approve(r.requestId, "wrong")).error, /not accepted/);
  assert.match((await approve(r.requestId, currentPassword, other.id)).error, /not found/);
  const result = await approve(r.requestId);
  assert.equal(result.ok, true, result.error);
  const retry = await approve(r.requestId);
  assert.deepEqual(result, retry);
  const audits = checked(
    await admin.client.from("dtr_admin_audit").select().eq("request_id", r.requestId),
  );
  assert.equal(audits.length, 1);
  assert.equal(audits[0].approval_method, "chief_ssp");
  assert.equal(audits[0].old_values, null);
  assert.equal(audits[0].new_values.id, result.record.id);
  assert.ok(!JSON.stringify(audits).includes(currentPassword));
  assert.deepEqual(checked(await trainee.client.from("dtr_admin_audit").select()), []);
  const exp = await prepare(
    "edit_dtr",
    payload({ expected: snapshot(result.record), values: { ...values, check_out: null } }),
  );
  await sql`UPDATE dtr_private.chief_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${exp.requestId}`;
  assert.match((await approve(exp.requestId)).error, /expired/);
});
test("invalid sequence, missing reason and stale reviewed records cannot change attendance", async () => {
  const row = checked(
    await local.admin.from("dtr_entries").select().eq("user_id", trainee.id).single(),
  );
  for (const extra of [
    { reason: "" },
    { values: { ...values, check_out: "2000-01-01T07:00:00+08:00" } },
    { values: { ...values, break_out: "2000-01-01T12:00:00+08:00" } },
    { values: { ...values, check_out: "2000-01-02T01:00:00+08:00" } },
    { expected: null },
  ]) {
    const r = await prepare("edit_dtr", payload({ expected: snapshot(row), ...extra }));
    assert.ok((await approve(r.requestId)).error);
  }
  assert.deepEqual(
    checked(await local.admin.from("dtr_entries").select().eq("id", row.id).single()),
    row,
  );
  const r = await prepare(
    "edit_dtr",
    payload({ expected: snapshot(row), values: { ...values, check_out: null } }),
  );
  checked(
    await local.admin
      .from("dtr_entries")
      .update({ check_out: "2000-01-01T18:00:00+08:00" })
      .eq("id", row.id),
  );
  assert.match((await approve(r.requestId)).error, /changed/);
});
test("valid correction atomically retains old values; removing punches keeps history and blocks deletion", async () => {
  const row = checked(
    await local.admin.from("dtr_entries").select().eq("user_id", trainee.id).single(),
  );
  const r = await prepare(
    "edit_dtr",
    payload({
      expected: snapshot(row),
      values: { check_in: null, break_out: null, break_in: null, check_out: null },
    }),
  );
  const result = await approve(r.requestId);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.record.id, row.id);
  const audit = checked(
    await local.admin.from("dtr_admin_audit").select().eq("request_id", r.requestId).single(),
  );
  assert.deepEqual(audit.old_values, row);
  assert.equal(audit.new_values.check_in, null);
  assert.equal(audit.actor_id, admin.id);
  assert.ok(audit.ssp_version);
  assert.match(
    (await prepare("delete_account", { targetUserId: trainee.id, confirmation: trainee.id })).error,
    /historical/,
  );
  assert.match(
    (await prepare("delete_account", { targetUserId: other.id, confirmation: other.id })).error,
    /Administrator/,
  );
});
test("five wrong attempts commit a 15 minute per-admin lockout", async () => {
  const r = await prepare("change_ssp", {});
  for (let i = 0; i < 5; i++) assert.ok((await approve(r.requestId, "wrong")).error);
  assert.match((await approve(r.requestId)).error, /temporarily/);
  const [attempt] =
    await sql`SELECT failures,blocked_until>clock_timestamp()+interval '14 minutes' AS blocked FROM dtr_private.chief_attempts WHERE actor_id=${admin.id}`;
  assert.ok(attempt.blocked);
  assert.equal(attempt.failures, 5);
  await sql`UPDATE dtr_private.chief_attempts SET blocked_until=clock_timestamp()-interval '1 second' WHERE actor_id=${admin.id}`;
});
test("password rotation invalidates old password and pending requests; recovery is one-use", async () => {
  const oldPending = await prepare("change_ssp", {});
  const r = await prepare("change_ssp", {});
  const next = `NewChief!${randomUUID()}`;
  const changed = await approve(r.requestId, currentPassword, admin.id, next);
  assert.equal(changed.ok, true, changed.error);
  currentPassword = next;
  assert.match((await approve(oldPending.requestId)).error, /expired/);
  const p = await prepare("change_ssp", {});
  assert.match((await approve(p.requestId, chiefPassword)).error, /not accepted/);
  const recovery = await prepare("recover_ssp", {});
  const newer = `Recovered!${randomUUID()}`;
  const recovered = await approve(recovery.requestId, currentRecovery, admin.id, newer);
  assert.equal(recovered.ok, true, recovered.error);
  assert.ok(recovered.recoveryCode);
  currentPassword = newer;
  assert.equal(
    (await approve(recovery.requestId, currentRecovery, admin.id, newer)).recoveryCode,
    undefined,
  );
  const reused = await prepare("recover_ssp", {});
  assert.match(
    (await approve(reused.requestId, currentRecovery, admin.id, `Different!${randomUUID()}`)).error,
    /not accepted/,
  );
  const audits = checked(
    await local.admin.from("dtr_admin_audit").select().eq("actor_id", admin.id),
  );
  for (const secret of [chiefPassword, currentPassword, currentRecovery, recovered.recoveryCode])
    assert.ok(!JSON.stringify(audits).includes(secret));
  currentRecovery = recovered.recoveryCode;
});
test("revoked admin cannot approve an already prepared request", async () => {
  const r = await prepare("change_ssp", {});
  checked(await local.admin.from("profiles").update({ is_active: false }).eq("id", admin.id));
  assert.match((await approve(r.requestId)).error, /administrator/);
  checked(await local.admin.from("profiles").update({ is_active: true }).eq("id", admin.id));
});
test("an audit failure rolls back the DTR mutation and its completed request state", async () => {
  const row = checked(
    await local.admin.from("dtr_entries").select().eq("user_id", trainee.id).single(),
  );
  const r = await prepare("edit_dtr", payload({ expected: snapshot(row) }));
  // Force the audit unique constraint to fail without changing production code.
  await sql`INSERT INTO public.dtr_admin_audit(request_id,action,actor_id,approval_method,ssp_version) VALUES(${r.requestId},'test_collision',${admin.id},'test',1)`;
  try {
    assert.match((await approve(r.requestId)).error, /not saved/);
    assert.deepEqual(
      checked(await local.admin.from("dtr_entries").select().eq("id", row.id).single()),
      row,
    );
    const [request] =
      await sql`SELECT result FROM dtr_private.chief_requests WHERE id=${r.requestId}`;
    assert.equal(request.result, null);
  } finally {
    await sql`DELETE FROM public.dtr_admin_audit WHERE request_id=${r.requestId}`;
  }
});
test("an audit failure rolls back permanent deletion, including Auth and profile", async () => {
  const { user } = checked(
    await local.admin.auth.admin.createUser({
      email: `${randomUUID()}@ojt.local.test`,
      password: `Test!${randomUUID()}`,
      email_confirm: true,
      user_metadata: {
        full_name: "Audit atomicity",
        student_id: randomUUID(),
        company: "PSA",
        ojt_title: "Intern",
      },
    }),
  );
  let requestId;
  try {
    const r = await prepare("delete_account", { targetUserId: user.id, confirmation: user.id });
    requestId = r.requestId;
    assert.ok(requestId);
    await sql`INSERT INTO public.dtr_admin_audit(request_id,action,actor_id,approval_method,ssp_version) VALUES(${requestId},'test_collision',${admin.id},'test',1)`;
    assert.match((await approve(requestId)).error, /not saved/);
    assert.equal(checked(await local.admin.auth.admin.getUserById(user.id)).user.id, user.id);
    assert.equal(
      checked(await local.admin.from("profiles").select("id").eq("id", user.id).single()).id,
      user.id,
    );
    const [pending] =
      await sql`SELECT result FROM dtr_private.chief_requests WHERE id=${requestId}`;
    assert.equal(pending.result, null);
  } finally {
    if (requestId) await sql`DELETE FROM public.dtr_admin_audit WHERE request_id=${requestId}`;
    checked(await local.admin.auth.admin.deleteUser(user.id));
  }
});
