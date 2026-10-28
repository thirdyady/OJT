import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { localSupabase, checked } from "../scripts/local-supabase.mjs";
const local = localSupabase();
const sql = postgres(local.databaseUrl, { max: 1 });
const monitor = local.client();
const employee = local.client();
const ids = [];
let monitorId, employeeId;
const password = `Test!${randomUUID()}`;
const email = `${randomUUID()}@security.psa-dtr.invalid`;
before(async () => {
  const security = checked(
    await local.admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: { dtr_access_role: "security_monitor" },
    }),
  );
  monitorId = security.user.id;
  ids.push(monitorId);
  checked(await monitor.auth.signInWithPassword({ email, password }));
  const personEmail = `${randomUUID()}@example.test`;
  const person = checked(
    await local.admin.auth.admin.createUser({
      email: personEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: "Monitor fixture",
        student_id: "TEST",
        company: "PSA",
        ojt_title: "Intern",
        dtr_access_role: "security_monitor",
      },
    }),
  );
  employeeId = person.user.id;
  ids.push(employeeId);
  checked(await employee.auth.signInWithPassword({ email: personEmail, password }));
  checked(
    await local.admin.from("dtr_entries").insert([
      { user_id: employeeId, entry_date: "2020-01-01", check_in: "2020-01-01T08:00:00+08:00" },
      {
        user_id: employeeId,
        entry_date: "2020-01-02",
        check_in: "2020-01-02T08:00:00+08:00",
        check_out: "2020-01-02T17:00:00+08:00",
      },
    ]),
  );
});
after(async () => {
  await monitor.auth.signOut();
  await employee.auth.signOut();
  await sql`DELETE FROM dtr_private.security_monitors WHERE user_id=${monitorId}`;
  for (const id of ids) {
    checked(await local.admin.from("dtr_entries").delete().eq("user_id", id));
    checked(await local.admin.auth.admin.deleteUser(id));
  }
  await sql.end();
});
test("monitor has no employee profile, no admin role, no direct private data access", async () => {
  assert.equal(checked(await monitor.rpc("dtr_is_security_monitor")), true);
  assert.equal(checked(await monitor.rpc("dtr_is_admin")), false);
  assert.equal(checked(await monitor.rpc("dtr_is_active")), false);
  assert.deepEqual(checked(await monitor.from("profiles").select()), []);
  assert.deepEqual(checked(await monitor.from("dtr_entries").select()), []);
  assert.deepEqual(checked(await local.admin.from("profiles").select().eq("id", monitorId)), []);
  assert.ok(
    (
      await monitor.from("profiles").insert({
        id: monitorId,
        full_name: "Forged",
        student_id: "X",
        company: "PSA",
        ojt_title: "X",
      })
    ).error,
  );
});
test("date-scoped log returns only permitted fields, supports paging and rejects future dates", async () => {
  const logs = checked(await monitor.rpc("dtr_security_logs", { log_date: "2020-01-01" }));
  const row = logs.find((r) => r.full_name === "Monitor fixture");
  assert.ok(row);
  assert.deepEqual(
    Object.keys(row).sort(),
    [
      "id",
      "full_name",
      "account_type",
      "check_in",
      "break_out",
      "break_in",
      "check_out",
      "travel_hours",
    ].sort(),
  );
  assert.equal(row.check_out, null);
  const next = checked(
    await monitor.rpc("dtr_security_logs", { log_date: "2020-01-01", after_id: row.id }),
  );
  assert.ok(next.every((r) => r.id > row.id));
  assert.ok((await monitor.rpc("dtr_security_logs", { log_date: "2999-01-01" })).error);
});
test("ordinary users cannot forge monitor privileges in user metadata or call logs", async () => {
  assert.equal(checked(await employee.rpc("dtr_is_security_monitor")), false);
  assert.ok((await employee.rpc("dtr_security_logs", { log_date: "2020-01-01" })).error);
  assert.ok((await local.client().rpc("dtr_security_logs", { log_date: "2020-01-01" })).error);
});
test("monitor cannot punch, edit, delete or administer accounts", async () => {
  assert.ok(
    (
      await monitor.rpc("dtr_punch", {
        action: "check_in",
        expected_date: "2020-01-01",
        expected_id: null,
        expected_check_in: null,
        expected_break_out: null,
        expected_break_in: null,
        expected_check_out: null,
        undo: false,
      })
    ).error,
  );
  assert.ok(
    (await monitor.from("dtr_entries").insert({ user_id: monitorId, entry_date: "2020-01-01" }))
      .error,
  );
  const beforeRows = checked(
    await local.admin.from("dtr_entries").select().eq("user_id", employeeId),
  );
  await monitor
    .from("dtr_entries")
    .update({ check_out: "2020-01-01T17:00:00+08:00" })
    .eq("user_id", employeeId);
  await monitor.from("dtr_entries").delete().eq("user_id", employeeId);
  assert.deepEqual(
    checked(await local.admin.from("dtr_entries").select().eq("user_id", employeeId)),
    beforeRows,
  );
  assert.ok(
    (
      await monitor.rpc("dtr_admin_set_account_active", {
        target_user_id: employeeId,
        target_active: false,
      })
    ).error,
  );
});
test("deactivation blocks an existing session immediately", async () => {
  await sql`UPDATE dtr_private.security_monitors SET is_active=false WHERE user_id=${monitorId}`;
  assert.ok((await monitor.rpc("dtr_security_logs", { log_date: "2020-01-01" })).error);
  await sql`UPDATE dtr_private.security_monitors SET is_active=true WHERE user_id=${monitorId}`;
});
test("monitor changes password without email and old password stops working", async () => {
  const next = `Changed!${randomUUID()}`;
  checked(await monitor.auth.updateUser({ password: next }));
  const fresh = local.client();
  assert.ok((await fresh.auth.signInWithPassword({ email, password })).error);
  checked(await fresh.auth.signInWithPassword({ email, password: next }));
  await fresh.auth.signOut();
});
