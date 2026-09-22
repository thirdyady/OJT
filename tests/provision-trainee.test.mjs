import { test } from "node:test";
import assert from "node:assert/strict";
import { provisionTrainee } from "../src/lib/provision-trainee.server.ts";

const input = {
  email: "provision@ojt.local.test",
  password: "Test-password",
  fullName: "Test",
  studentId: "TEST",
  company: "PSA",
  ojtTitle: "Intern",
  requiredOjtHours: 486,
};

function client({
  authFails = false,
  authThrows = false,
  profileThrows = false,
  cleanupFails = false,
  cleanupThrows = false,
  success = false,
} = {}) {
  const deleted = [];
  const created = [];
  const profiles = [];
  const admin = {
    auth: {
      admin: {
        createUser: async (data) => {
          created.push(data);
          if (authThrows) throw new Error("Auth unavailable");
          return authFails
            ? { data: {}, error: { message: "Duplicate email" } }
            : { data: { user: { id: "new-account" } }, error: null };
        },
        deleteUser: async (id) => {
          deleted.push(id);
          if (cleanupThrows) throw new Error("Cleanup network failure");
          return { error: cleanupFails ? { message: "Cleanup unavailable" } : null };
        },
      },
    },
    from: () => ({
      upsert: (data) => {
        profiles.push(data);
        return {
          select: () => ({
            single: async () => {
              if (profileThrows) throw new Error("Network interrupted");
              if (success) return { data, error: null };
              return { data: null, error: { message: "Profile write failed" } };
            },
          }),
        };
      },
    }),
  };
  return { admin, deleted, created, profiles };
}

test("failed profile setup removes only the newly created account", async () => {
  for (const profileThrows of [false, true]) {
    const fixture = client({ profileThrows });
    await assert.rejects(provisionTrainee(fixture.admin, input), /rolled back/);
    assert.deepEqual(fixture.deleted, ["new-account"]);
  }
});

test("failed cleanup is reported without falsely claiming rollback", async () => {
  for (const options of [{ cleanupFails: true }, { cleanupThrows: true }]) {
    const fixture = client(options);
    await assert.rejects(provisionTrainee(fixture.admin, input), /automatic cleanup also failed/);
    assert.deepEqual(fixture.deleted, ["new-account"]);
  }
});

for (const accountType of ["ojt", "job_order", "processing", "regular_employee"]) {
  test(`provisions ${accountType} with confirmed email, temporary password and correct persisted targets`, async () => {
    const fixture = client({ success: true });
    const data = {
      ...input,
      accountType,
      studentId: accountType === "ojt" ? input.studentId : null,
      requiredOjtHours: accountType === "ojt" ? 486 : null,
      requiredWorkdays: accountType === "processing" ? 90 : null,
    };
    const { profile } = await provisionTrainee(fixture.admin, data);
    assert.equal(profile.account_type, accountType);
    assert.equal(profile.required_ojt_hours, data.requiredOjtHours);
    assert.equal(profile.required_workdays, data.requiredWorkdays);
    assert.equal(profile.student_id, data.studentId);
    assert.equal(profile.is_admin, false);
    assert.equal(fixture.created[0].email_confirm, true);
    assert.equal(fixture.created[0].password, input.password);
    assert.equal(fixture.created[0].app_metadata.dtr_account_type, accountType);
    assert.equal(fixture.created[0].user_metadata.account_type, undefined);
    assert.deepEqual(fixture.deleted, []);
  });
}

test("invalid input is rejected before Auth allocation, including forged administrator fields", async () => {
  for (const patch of [
    { email: "not-an-email" },
    { email: "" },
    { password: "short" },
    { fullName: "  " },
    { company: "  " },
    { ojtTitle: "  " },
    { studentId: "  " },
    { is_admin: true },
    { accountType: "admin" },
    { requiredOjtHours: 0 },
    { requiredOjtHours: Infinity },
    { accountType: "processing", studentId: null, requiredOjtHours: null, requiredWorkdays: null },
    { accountType: "processing", studentId: null, requiredOjtHours: null, requiredWorkdays: 1.5 },
    { accountType: "job_order", studentId: null, requiredOjtHours: null, requiredWorkdays: 5 },
    { accountType: "regular_employee", studentId: null, requiredOjtHours: 10 },
  ]) {
    const fixture = client({ success: true });
    await assert.rejects(provisionTrainee(fixture.admin, { ...input, ...patch }));
    assert.equal(fixture.created.length, 0);
    assert.equal(fixture.profiles.length, 0);
    assert.equal(fixture.deleted.length, 0);
  }
});

test("Auth network failure cannot report success or delete an unrelated account", async () => {
  const fixture = client({ authThrows: true });
  await assert.rejects(provisionTrainee(fixture.admin, input), /Auth unavailable/);
  assert.deepEqual(fixture.deleted, []);
  assert.deepEqual(fixture.profiles, []);
});

test("failed Auth creation never attempts to delete an existing account", async () => {
  const fixture = client({ authFails: true });
  await assert.rejects(provisionTrainee(fixture.admin, input), /Account was not created/);
  assert.deepEqual(fixture.deleted, []);
});
