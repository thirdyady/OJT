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

function client({ authFails = false, profileThrows = false, cleanupFails = false } = {}) {
  const deleted = [];
  const admin = {
    auth: {
      admin: {
        createUser: async () =>
          authFails
            ? { data: {}, error: { message: "Duplicate email" } }
            : { data: { user: { id: "new-account" } }, error: null },
        deleteUser: async (id) => {
          deleted.push(id);
          return { error: cleanupFails ? { message: "Cleanup unavailable" } : null };
        },
      },
    },
    from: () => ({
      upsert: () => ({
        select: () => ({
          single: async () => {
            if (profileThrows) throw new Error("Network interrupted");
            return { data: null, error: { message: "Profile write failed" } };
          },
        }),
      }),
    }),
  };
  return { admin, deleted };
}

test("failed profile setup removes only the newly created account", async () => {
  for (const profileThrows of [false, true]) {
    const fixture = client({ profileThrows });
    await assert.rejects(provisionTrainee(fixture.admin, input), /rolled back/);
    assert.deepEqual(fixture.deleted, ["new-account"]);
  }
});

test("failed cleanup is reported without falsely claiming rollback", async () => {
  const fixture = client({ cleanupFails: true });
  await assert.rejects(provisionTrainee(fixture.admin, input), /automatic cleanup also failed/);
  assert.deepEqual(fixture.deleted, ["new-account"]);
});

test("failed Auth creation never attempts to delete an existing account", async () => {
  const fixture = client({ authFails: true });
  await assert.rejects(provisionTrainee(fixture.admin, input), /Account was not created/);
  assert.deepEqual(fixture.deleted, []);
});
