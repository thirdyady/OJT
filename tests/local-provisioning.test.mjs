import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { provisionTrainee } from "../src/lib/provision-trainee.server.ts";
import { localSupabase, checked } from "../scripts/local-supabase.mjs";

const local = localSupabase();
const input = (accountType) => ({
  accountType,
  email: `${randomUUID()}@ojt.local.test`,
  password: `Provision!${randomUUID()}`,
  fullName: "Provisioning test",
  studentId: accountType === "ojt" ? "MANUAL-ID" : null,
  company: "PSA",
  ojtTitle: "Test position",
  requiredOjtHours: accountType === "ojt" ? 486 : null,
  requiredWorkdays: accountType === "processing" ? 90 : null,
});

for (const type of ["ojt", "job_order", "processing", "regular_employee"]) {
  test(`real Auth and profile provisioning: ${type}, confirmed email and usable temporary password`, async () => {
    const data = input(type);
    let id;
    const client = local.client();
    try {
      const result = await provisionTrainee(local.admin, data);
      id = result.profile.id;
      const row = checked(await local.admin.from("profiles").select().eq("id", id).single());
      const { user } = checked(await local.admin.auth.admin.getUserById(id));
      assert.ok(user.email_confirmed_at);
      assert.equal(row.account_type, type);
      assert.equal(row.required_workdays, data.requiredWorkdays);
      assert.equal(row.required_ojt_hours, data.requiredOjtHours);
      assert.equal(row.student_id, data.studentId);
      assert.equal(row.ojt_title, data.ojtTitle);
      assert.equal(row.is_admin, false);
      assert.equal(checked(await client.auth.signInWithPassword(data)).user.id, id);
      await assert.rejects(provisionTrainee(local.admin, data), /Account was not created/);
      assert.equal(checked(await local.admin.auth.admin.getUserById(id)).user.id, id);
      assert.deepEqual(
        checked(await local.admin.from("profiles").select().eq("id", id).single()),
        row,
      );
    } finally {
      await client.auth.signOut();
      if (id) checked(await local.admin.auth.admin.deleteUser(id));
    }
  });
}

test("actual partial creation is rolled back when the profile persistence step fails", async () => {
  for (const type of ["ojt", "job_order", "processing", "regular_employee"]) {
    let id;
    const faulty = {
      auth: {
        admin: {
          createUser: async (data) => {
            const result = await local.admin.auth.admin.createUser(data);
            id = result.data.user?.id;
            return result;
          },
          deleteUser: (userId) => local.admin.auth.admin.deleteUser(userId),
        },
      },
      from: () => ({
        upsert: () => ({
          select: () => ({
            single: async () => {
              assert.ok(id);
              // The real signup trigger has already created the profile at this point.
              assert.equal(
                checked(await local.admin.from("profiles").select("id").eq("id", id).single()).id,
                id,
              );
              return { data: null, error: { message: "Injected profile failure" } };
            },
          }),
        }),
      }),
    };
    try {
      await assert.rejects(provisionTrainee(faulty, input(type)), /rolled back/);
      assert.ok((await local.admin.auth.admin.getUserById(id)).error);
      assert.deepEqual(checked(await local.admin.from("profiles").select().eq("id", id)), []);
    } finally {
      if (id && !(await local.admin.auth.admin.getUserById(id)).error) {
        checked(await local.admin.auth.admin.deleteUser(id));
      }
    }
  }
});
