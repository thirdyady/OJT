// A browser-wide UX cooldown, not a replacement for Supabase Auth rate limits.
// Persist only a timestamp; never store the recipient address or credentials.
export const RECOVERY_COOLDOWN_MS = 60_000;
export const RECOVERY_COOLDOWN_KEY = "dtr-recovery-retry-at";
export const RECOVERY_REQUEST_MESSAGE =
  "If an account exists for this email, a reset link will be sent if the request can be processed. Check your inbox and spam folder. If no email arrives, try again later or contact your administrator.";
let retryAt = 0;
export function recoveryWaitSeconds(now = Date.now()): number {
  let saved = 0;
  try {
    if (typeof window !== "undefined")
      saved = Number(window.localStorage.getItem(RECOVERY_COOLDOWN_KEY));
  } catch {
    /* Memory fallback when browser storage is unavailable. */
  }
  const valid = (value: number) =>
    Number.isFinite(value) && value > now && value <= now + RECOVERY_COOLDOWN_MS;
  const deadline = Math.max(valid(retryAt) ? retryAt : 0, valid(saved) ? saved : 0);
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
export function startRecoveryCooldown(now = Date.now()): void {
  retryAt = now + RECOVERY_COOLDOWN_MS;
  try {
    if (typeof window !== "undefined")
      window.localStorage.setItem(RECOVERY_COOLDOWN_KEY, String(retryAt));
  } catch {
    /* The in-memory cooldown still prevents repeated clicks. */
  }
}
