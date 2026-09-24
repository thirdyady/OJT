// Local-only fixtures. The connector refuses hosted databases.
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { localSupabase, checked } from "../scripts/local-supabase.mjs";
export const chiefPassword = `TestChief!${randomUUID()}`;
export const recoveryCode = `TestRecovery!${randomUUID()}`;
let ready;
export function setupChief(reset = false) {
  if (reset) ready = undefined;
  return (ready ??= (async () => {
    const local = localSupabase();
    const sql = postgres(local.databaseUrl, { max: 1 });
    try {
      await sql`INSERT INTO dtr_private.chief_secret(singleton,password_hash,recovery_hash,must_change) VALUES(true,extensions.crypt(${chiefPassword},extensions.gen_salt('bf',4)),extensions.crypt(${recoveryCode},extensions.gen_salt('bf',4)),false) ON CONFLICT(singleton) DO UPDATE SET password_hash=EXCLUDED.password_hash,recovery_hash=EXCLUDED.recovery_hash,must_change=false,version=dtr_private.chief_secret.version+1`;
    } finally {
      await sql.end();
    }
  })());
}
export async function prepareChief(local, actor, operation, payload, id = randomUUID()) {
  const result = checked(
    await local.admin.rpc("dtr_chief_prepare", {
      actor_user_id: actor,
      request_id: id,
      operation,
      payload,
    }),
  );
  return result;
}
export async function approveChief(
  local,
  actor,
  requestId,
  credential = chiefPassword,
  newPassword,
) {
  return checked(
    await local.admin.rpc("dtr_chief_approve", {
      actor_user_id: actor,
      request_id: requestId,
      credential,
      ...(newPassword ? { new_password: newPassword } : {}),
    }),
  );
}
export async function deleteWithChief(local, actor, target, confirmation = target) {
  await setupChief();
  const p = await prepareChief(local, actor, "delete_account", {
    targetUserId: target,
    confirmation,
  });
  if (p.error) return { error: { message: p.error }, data: null };
  const a = await approveChief(local, actor, p.requestId);
  return a.error ? { error: { message: a.error }, data: null } : { error: null, data: a.deletedId };
}
export async function approvePopup(page, password = chiefPassword) {
  await setupChief();
  await page.getByLabel("Chief Approval Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /^Approve and (Save|Delete)$/ }).click();
}
export async function saveCorrection(page) {
  await page
    .getByLabel("Correction reason", { exact: true })
    .fill("Corrected against approved attendance record");
  await page.getByRole("button", { name: "Save Changes", exact: true }).click();
  await approvePopup(page);
}
