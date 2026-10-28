import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { localSupabase, checked } from "../scripts/local-supabase.mjs";
import { setupChief, prepareChief, approveChief, chiefPassword } from "./chief-fixture.mjs";
import { calculateCompletedHours } from "../src/lib/ojt-progress.mjs";
const local = localSupabase(),
  users = [];
const date = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
async function create(type = "job_order", isAdmin = false) {
  const email = `${randomUUID()}@example.test`,
    password = `Travel!${randomUUID()}`;
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
        full_name: "Travel fixture",
        company: "PSA",
        ojt_title: "Employee",
        student_id: "T",
      },
    }),
  );
  const client = local.client();
  users.push({ id: user.id, client });
  if (isAdmin)
    checked(await local.admin.from("profiles").update({ is_admin: true }).eq("id", user.id));
  checked(await client.auth.signInWithPassword({ email, password }));
  return users.at(-1);
}
const travel = (u, extra = {}) =>
  u.client.rpc("dtr_travel_out", {
    expected_date: date(),
    hours: 8,
    place: "Bukidnon",
    reason: "Official field visit",
    ...extra,
  });
const punch = (u) =>
  u.client.rpc("dtr_punch", {
    action: "check_in",
    expected_date: date(),
    expected_id: null,
    expected_check_in: null,
    expected_break_out: null,
    expected_break_in: null,
    expected_check_out: null,
    undo: false,
  });
before(setupChief);
after(async () => {
  for (const u of users) {
    await u.client.auth.signOut();
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", u.id));
    checked(await local.admin.auth.admin.deleteUser(u.id));
  }
});
for (const type of ["job_order", "regular_employee"])
  test(`${type}: saves 8/10 travel hours without punches, protects history and rejects duplicate`, async () => {
    const u = await create(type);
    const row = checked(await travel(u, { hours: type === "job_order" ? 8 : 10 }));
    assert.equal(calculateCompletedHours(row), type === "job_order" ? 8 : 10);
    assert.equal(row.entry_date, date());
    assert.equal(row.check_in, null);
    assert.equal(row.check_out, null);
    assert.ok((await travel(u)).error);
    assert.ok((await punch(u)).error);
    assert.ok(
      (
        await u.client
          .from("dtr_entries")
          .insert({
            user_id: u.id,
            entry_date: "2000-01-01",
            travel_hours: 10,
            travel_place: "Ozamis",
            travel_reason: "Other",
          })
      ).error,
    );
    await u.client.from("dtr_entries").update({ travel_hours: 10 }).eq("id", row.id);
    assert.deepEqual(
      checked(await local.admin.from("dtr_entries").select().eq("id", row.id).single()),
      row,
    );
    assert.ok((await local.admin.auth.admin.deleteUser(u.id)).error);
  });
test("roles, inactive status, today-only dates and required values enforced server-side", async () => {
  for (const type of ["ojt", "processing"]) assert.ok((await travel(await create(type))).error);
  assert.ok((await travel(await create("job_order", true))).error);
  const u = await create();
  checked(await local.admin.from("profiles").update({ is_active: false }).eq("id", u.id));
  assert.ok((await travel(u)).error);
  checked(await local.admin.from("profiles").update({ is_active: true }).eq("id", u.id));
  for (const invalid of [
    { hours: 9 },
    { hours: 8.5 },
    { place: "" },
    { place: "1234567890123456" },
    { reason: "" },
    { reason: "   " },
    { place: "\t" },
    { expected_date: "2000-01-01" },
    { expected_date: "2999-01-01" },
  ])
    assert.ok((await travel(u, invalid)).error, JSON.stringify(invalid));
  assert.deepEqual(checked(await u.client.from("dtr_entries").select()), []);
  assert.ok(
    (
      await local
        .client()
        .rpc("dtr_travel_out", {
          expected_date: date(),
          hours: 8,
          place: "Cagayan",
          reason: "Visit",
        })
    ).error,
  );
});
test("travel versus first punch and simultaneous travel requests have exactly one winner", async () => {
  for (const race of ["punch", "travel"]) {
    const u = await create();
    const results = await Promise.all([
      travel(u),
      race === "punch" ? punch(u) : travel(u, { hours: 10 }),
    ]);
    assert.equal(results.filter((r) => !r.error).length, 1);
    assert.equal(checked(await u.client.from("dtr_entries").select()).length, 1);
  }
  const u = await create();
  checked(await punch(u));
  assert.ok((await travel(u)).error);
});
test("database forbids mixed punches/travel and unauthorized account categories", async () => {
  const u = await create();
  assert.ok(
    (
      await local.admin
        .from("dtr_entries")
        .insert({
          user_id: u.id,
          entry_date: date(),
          travel_hours: 8,
          travel_place: "Bukidnon",
          travel_reason: "Trip",
          check_in: new Date().toISOString(),
        })
    ).error,
  );
  const o = await create("ojt");
  assert.ok(
    (
      await local.admin
        .from("dtr_entries")
        .insert({
          user_id: o.id,
          entry_date: date(),
          travel_hours: 8,
          travel_place: "Bukidnon",
          travel_reason: "Trip",
        })
    ).error,
  );
});
test("Chief correction supports historical travel, audits details, prevents stale edits and converts to normal punches", async () => {
  const admin = await create("ojt", true),
    u = await create();
  const values = {
    check_in: null,
    break_out: null,
    break_in: null,
    check_out: null,
    travel_hours: 8,
    travel_place: "Bukidnon",
    travel_reason: "Agency meeting",
  };
  const payload = {
    targetUserId: u.id,
    date: "2000-01-01",
    expected: null,
    values,
    reason: "Missed travel filing",
  };
  const prep = await prepareChief(local, admin.id, "edit_dtr", payload);
  const result = await approveChief(local, admin.id, prep.requestId, chiefPassword);
  assert.equal(result.ok, true, JSON.stringify(result));
  const saved = result.record;
  assert.equal(saved.travel_hours, 8);
  const snapshot = Object.fromEntries(
    [
      "id",
      "check_in",
      "break_out",
      "break_in",
      "check_out",
      "travel_hours",
      "travel_place",
      "travel_reason",
    ].map((k) => [k, saved[k]]),
  );
  const correction = await prepareChief(local, admin.id, "edit_dtr", {
    ...payload,
    expected: snapshot,
    values: { ...values, travel_hours: 10 },
    reason: "Verified travel hours",
  });
  const changed = await approveChief(local, admin.id, correction.requestId, chiefPassword);
  assert.equal(changed.ok, true);
  assert.equal(
    (await approveChief(local, admin.id, correction.requestId, chiefPassword)).record.id,
    saved.id,
  );
  const audit = checked(
    await local.admin.from("dtr_admin_audit").select().eq("request_id", correction.requestId),
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].old_values.travel_hours, 8);
  assert.equal(audit[0].new_values.travel_hours, 10);
  const stale = await prepareChief(local, admin.id, "edit_dtr", { ...payload, expected: snapshot });
  assert.match(
    (await approveChief(local, admin.id, stale.requestId, chiefPassword)).error,
    /changed/i,
  );
  const latest = { ...snapshot, travel_hours: 10 };
  const normal = {
    check_in: "2000-01-01T08:00:00+08:00",
    break_out: null,
    break_in: null,
    check_out: "2000-01-01T17:00:00+08:00",
    travel_hours: null,
    travel_place: null,
    travel_reason: null,
  };
  const convert = await prepareChief(local, admin.id, "edit_dtr", {
    ...payload,
    expected: latest,
    values: normal,
  });
  const final = await approveChief(local, admin.id, convert.requestId, chiefPassword);
  assert.equal(final.ok, true, JSON.stringify(final));
  assert.equal(final.record.travel_hours, null);
  assert.equal(calculateCompletedHours(final.record), 9);
});
