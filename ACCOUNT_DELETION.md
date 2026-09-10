# Milestone 6 — safe deletion of unused trainee accounts

Routine removal should use **Deactivate account**. It preserves the profile and
attendance while preventing protected DTR operations. Permanent deletion is
limited to non-admin trainee accounts with **zero existing DTR rows**, including
empty/incomplete rows. Active and inactive unused trainees are eligible.

## Final behavior

1. An active admin selects a trainee in Manage Accounts. The delete control is
   disabled for administrators, while attendance is loading, after a load error,
   and whenever any DTR rows were loaded.
2. **Delete unused account** opens a modal showing the trainee's name and unique
   account ID, explaining the irreversible loss of the login, profile, and Auth
   sessions. The admin must type the exact full account ID. Cancel does nothing.
3. A same-origin POST server function verifies the caller's authentication and
   current admin role. The browser never supplies the trusted actor identity.
4. A service-role-only database RPC repeats authorization and locks both profile
   rows for the transaction. It rejects inactive/non-admin actors, self-deletion,
   admin targets, missing accounts, wrong confirmation, existing DTR rows, and
   Storage objects owned through `owner_id`. It deletes the Auth user and returns
   the deleted ID only after the transaction succeeds.
5. The account list updates after confirmed success. On a failed/lost response,
   the UI refreshes the database state and reports uncertainty honestly; it does
   not claim a rollback if the server committed before the connection failed.

## Data preservation and concurrency

Before this milestone, both `profiles.id` and `dtr_entries.user_id` referenced
`auth.users.id` with `ON DELETE CASCADE`. Deleting an Auth user destroyed the
profile and every attendance row. The inspected local public schema has only
these two application tables.

Migration `20260910000000_safe_account_deletion.sql` changes only the DTR foreign
key's delete action to **RESTRICT**, retaining all records. The profile still
cascades for eligible empty accounts. The existing Auth cascades remove linked
identities, sessions, refresh tokens, MFA dependencies, one-time tokens, OAuth
authorizations/consents, and WebAuthn dependencies. No attendance is archived,
anonymized, or deleted by the new account-deletion operation.

The database constraint protects even a direct Auth-admin deletion attempt. If
an attendance insert commits first, deletion fails and preserves the account
and row. If deletion commits first, the insert fails because its parent account
no longer exists. Both orders were tested with held PostgreSQL transactions,
explicitly observing blocking locks before releasing them.

The service-only RPC makes role/status checks and deletion one transaction.
It uses a restricted search path, explicit grants, and profile row locks, so
concurrent role/status updates cannot invalidate checks halfway through the
transaction. The server supplies the actor from verified authentication, not
from submitted JSON. Direct RPC calls from anonymous users, trainees, and even
authenticated admins are denied; browser admins must use the server function.

Already-issued JWTs may remain cryptographically valid until expiry. Removing
the profile makes existing `dtr_is_active()` and `dtr_is_admin()` checks false;
the DTR foreign key also blocks new rows. Tests verify old-session writes,
fresh sign-in, and refresh fail after deletion. See
[Supabase user management](https://supabase.com/docs/guides/auth/managing-user-data)
and [PostgreSQL foreign keys](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK).

This is not a new attendance-retention policy. Existing authorized DTR row
editing/deletion remains unchanged. Retention rules for accounts with historical
records must be agreed before implementing any broader deletion feature.

## Changed files for this milestone

| File | Purpose |
| --- | --- |
| `supabase/migrations/20260910000000_safe_account_deletion.sql` | DTR RESTRICT constraint and atomic service-only deletion RPC |
| `src/lib/admin-account.functions.ts` | Authenticated server deletion endpoint |
| `src/integrations/supabase/types.ts` | New RPC's argument/return types |
| `src/routes/_authenticated/dashboard.tsx` | Typed confirmation, eligibility hints, error handling and list reconciliation |
| `tests/local-deletion.test.mjs` | Authorization, preservation, session cleanup and deterministic concurrency tests |
| `tests/e2e/account-deletion.spec.ts` | Confirmation, endpoint authorization, changed history and lost-response browser tests |
| `tests/local-access.test.mjs`, `tests/e2e/workflows.spec.ts`, `tests/e2e/review-regressions.spec.ts` | Remove only their own temporary DTR fixtures before test-account cleanup; cannot rely on cascade anymore |
| `scripts/local-supabase.mjs` | Validated localhost-only database URL for transaction tests |
| `package.json`, `package-lock.json` | PostgreSQL test client as a development dependency and local test command |
| `LOCAL_TESTING.md`, `ACCOUNT_DELETION.md` | Updated behavior and testing/rollout instructions |

Pre-existing Milestone 5 changes remain in the working tree and were preserved.
No hosted data or deployment was changed.

## Manual checks

Use local accounts only. Start local Supabase, apply pending local migrations
with `npx --yes supabase db push --local`, then run `npm run local:dev`.

1. Sign in as admin and create a disposable trainee. Do not record attendance.
2. Select it, open Delete unused account, type an incorrect ID, and verify the
   final button stays disabled. Cancel and confirm the account remains.
3. Reopen, type the displayed ID exactly, and confirm. Verify the account leaves
   the list and its credentials no longer sign in.
4. Select a trainee with DTR history. Verify deletion is disabled. Deactivate and
   reactivate it; the profile/history must remain intact.
5. Select an admin. Verify permanent deletion is disabled.
6. With a new disposable trainee, open confirmation before recording its first
   attendance in another browser session. Submit the deletion afterward. It must
   fail and preserve that trainee and attendance.

Automated checks: `npm run test:local`, `npm run test:e2e`,
`npm run typecheck`, and `npm run build`. The database concurrency tests use
the local CLI's database URL and refuse non-local hosts. Fixture cleanup deletes
only the temporary users/rows created by the tests.

## Before hosted rollout

Validation on September 10, 2026: 13 local database/calculation tests and all
16 browser tests passed. TypeScript, production build, targeted ESLint, and
`git diff --check` passed. The public build contains neither the local service-role
credential nor the privileged deletion RPC implementation. The existing large
client chunk and tsconfig-path advisory warnings remain. No hosted deployment
was tested or changed.

- Review hosted foreign keys and related tables against this migration, including
  any custom Auth triggers or Storage ownership. This milestone inspected local
  schema only; do not assume a hosted project is identical.
- Apply the migration before deploying the new UI/server endpoint. Without the
  RPC, deletion fails; there is no fallback to unsafe cascading deletion.
- Supply the existing server-only Supabase service-role environment variable.
  Never add it to `VITE_*` variables or browser code.
- Smoke-test using a disposable unused trainee and a separate protected trainee
  with history, including existing sessions and deactivation/reactivation.
- Do not roll the DTR foreign key back to CASCADE while this feature is available.
  Disabling the UI/endpoint is preferable to removing the preservation safeguard.
