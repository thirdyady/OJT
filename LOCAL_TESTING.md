# Local development and milestones 1–4

This setup runs the existing frontend against a separate Supabase database on
your PC. It does not create hosted admin accounts or change hosted data.

## Start

From the `OJT` folder, with Docker Desktop running:

```powershell
npm ci
npm run local:start
npm run local:seed
npm run local:dev
```

Open http://localhost:3000. The first Supabase start downloads Docker images and
can take several minutes. Docker must stay running while testing.

The seed command creates:

| Role | Email |
| --- | --- |
| Admin | admin@ojt.local.test |
| Trainee | trainee@ojt.local.test |
| Second trainee | other@ojt.local.test |

Passwords are randomly generated and saved in `.local-test-accounts.json` in this
folder. Open that file in the editor to copy a password. It is ignored by Git.
These logins work only with the local database. The admin can browse both
trainees and test clearing/deleting their sample attendance.

`local:seed` also writes `.env.development.local` with the local public connection
values. The existing `.env` stays unchanged, and production builds do not load
this development-only override. Restart Vite after creating/changing it. To return
to the hosted development connection, move `.env.development.local` out of this
folder and restart Vite. Re-running seed restores test-account passwords from the
credentials file and adds missing sample records; it does not erase attendance.

Use `npx --yes supabase status` to see the local Studio and email-inbox URLs.
Local recovery/confirmation emails are captured in that inbox rather than sent
to real recipients. Local signup requires email confirmation. Seed accounts are
pre-confirmed. Stop the stack with `npx --yes supabase stop` when finished.

## What changed

- Forgot-password email request and `/reset-password` form, including password
  confirmation, invalid-link errors, and success feedback.
- Change-password link on the signed-in dashboard, using the same form.
- Attendance remains unchanged on screen until a database write succeeds.
  Duplicate clicks are blocked while saving. Timestamp comparisons prevent stale
  tabs from overwriting changed records; reload before retrying a conflict.
- Undo and admin punch clearing now require confirmation. Admin deletion and
  clearing verify that the database actually returned the changed record.
- Profile and initial-record load failures are displayed. Profile inputs are
  disabled while saving so later edits cannot be marked saved accidentally.
- New trainee registration requires Full Name, Student ID, Host Company, and OJT
  Title. Those values are copied into the profile during signup.
- The PSA logo is shown in the signed-in dashboard header for both trainees and
  admins. Trainee details now include OJT Title. Legacy incomplete profiles stay
  usable and show a completion prompt without hiding attendance records.
- Trainees can set a school-specific required OJT-hours target after signing in.
  Progress uses all persisted complete DTR days, while the monthly DTR total stays
  scoped to the selected month. Incomplete days are excluded, and over-target
  completion is shown clearly.
- Admins have a Manage Accounts section with an account list and selected-account
  profile editor. They can update Full Name, Student ID, Host Company, OJT Title,
  and the school-specific required-hours target through a narrow protected RPC.
- Admins can activate or deactivate trainee accounts. Deactivation keeps the
  profile and DTR history, blocks trainee DTR/profile writes at the database
  layer, and signs out an inactive trainee when an existing session is checked.
- Admins can create complete trainee accounts from Manage Accounts. Account
  creation runs in a TanStack Start server function: the browser sends only the
  validated form data, while the Supabase service-role key stays in the server
  environment. If profile setup fails after Auth creation, the temporary Auth
  user is removed automatically.
- Permanent account deletion is not available in this milestone. Existing DTR
  entry delete/clear controls remain separate.
- Additive admin migration, read/update/delete policies for the existing admin
  DTR UI, and a trigger blocking browser-based role changes.
- Local seed scripts and repeatable API/browser regression tests.

## Manual checks

1. Sign in as a trainee. Complete Check In → Break Out → Break In → Check Out.
   Refresh after each action and verify the saved values remain.
2. Click Undo last, cancel, and confirm the value remains. Repeat and accept;
   only the last punch should clear.
3. In browser developer tools, block Supabase requests or use offline mode.
   Try a punch or profile save. Expect an error and no false success. Restore
   networking and reload before retrying.
4. Open the same trainee in two tabs. Save a punch in one, then attempt the same
   punch in the stale tab. It should fail rather than overwrite the timestamp.
5. Sign out and use Forgot password. Open the email in the local inbox, follow
   its link, try mismatched passwords, then matching passwords. Sign out and
   verify the new password works. Seed again to restore the original test password.
6. While signed in, follow Change password and verify the same form works.
7. Sign in as the local admin. Confirm the Manage Accounts heading and account
   list are visible. Select a trainee, edit Full Name, Student ID, Host Company,
   OJT Title, and Required OJT hours, then click Save trainee profile. Refresh or
   sign in as that trainee and verify the updated values. Test mobile width too.
8. In Manage Accounts, use Create trainee account with a new email, temporary
   password, full profile details, and a target such as `486`. Verify the new
   trainee appears as active and can sign in with the supplied credentials. Try
   a duplicate email and invalid/blank fields; each should be rejected without
   creating another account. A regular trainee must not see this form.
9. While still an admin, cancel and accept a punch-clear confirmation, and test
   deletion on sample attendance. Account deletion should not be offered.
10. Verify month/year filtering, CSV, print preview, and Word export still work.
   Yesterday's seeded sample is eight hours; select the previous month if today
   is the first of a month.
11. Open Sign up and verify Full Name, Student ID, Host Company, and OJT Title are
   required. Complete all four fields, register, and confirm the account-created
   message. Local confirmation links appear in the Supabase inbox.
12. To exercise legacy completion, create or use a profile with blank Student ID,
    Host Company, or OJT Title. The dashboard should still show the DTR controls
    and existing records. Fill every required field, save, and verify the prompt
    disappears. The admin trainee list should show the saved OJT Title.
13. In the trainee dashboard, enter a target such as `486` in Required hours and
    click Save target. Verify Required, Completed, Remaining, and Complete values.
    Change the DTR month and confirm cumulative Completed stays based on all
    months while the monthly DTR total changes.
14. Sign in as a trainee and verify Manage Accounts is absent. A trainee should
    never see another account or an account-edit form. Direct role/profile/RPC
    escalation attempts should be rejected by the database tests.
15. Set a target equal to or below completed hours to see the completion message;
   the progress bar caps at 100% while any overage is stated in the message.
16. In two browser sessions, sign in as the trainee in one and the local admin in
   the other. In Manage Accounts, deactivate the trainee. Try a DTR punch in the
   already-signed-in trainee session; it should sign out and return to `/auth`.
   Confirm the trainee's existing DTR history remains visible to the admin. Reactivate
   the account, sign in as the trainee again, and verify DTR controls work.

## Automated checks

```powershell
npm run typecheck
npm run build
npm run lint
npm run test:local
npm run test:e2e
```

The API and browser tests require the local Supabase stack. Run `local:seed`
first. Stop a manually running Vite server before `test:e2e`; Playwright starts
its own server on port 3000. Browser tests use the installed Microsoft Edge in
headless mode. Test users are temporary and cleaned up afterwards. API tests
verify trainee isolation, admin permissions, duplicate-day constraints, blocked
role escalation, admin profile/target updates, and trainee cross-account write
denial, and the protected admin account-creation server function. Progress calculation tests cover complete/incomplete days, breaks,
multiple months, exact completion, and over-target completion. Browser tests
cover attendance persistence, network failure, confirmations, CSV download,
admin access, Manage Accounts visibility, admin profile/OJT title/target editing,
password recovery, profile completion, target editing, and account status/session
enforcement.

## Validation recorded on September 8–9, 2026

- Production build and TypeScript checks passed.
- Lint passed for all changed application code, scripts, tests, and generated
  database types. The full-repository lint command still reports pre-existing
  formatting/line-ending issues and component-export warnings in untouched files.
- Local database access and progress calculation regression passed (8 tests),
  including role-escalation, account-status, and admin-target checks.
- Browser workflows passed: attendance/admin management, password recovery, new
  registration metadata, and legacy profile completion. The attendance workflow
  also checks failed profile saves and stale-tab conflicts; Milestone 3A checks
  Manage Accounts visibility and admin profile, OJT Title, target editing, and
  account activation/deactivation. The signed-in trainee workflow checks that
  deactivation ends access and reactivation restores it.
- The Milestone 3A migration applied locally and appears in the local migration
  list. No hosted schema or privileged browser key was changed.
- The Milestone 3B account-status migration applied locally and appears in the
  local migration list. Existing profiles and attendance rows were preserved.
- Milestone 4 account creation was exercised locally through the server function;
  the non-admin direct endpoint test was rejected and did not create a user.
- The local development helper supplies the service-role key only to the Start
  server process. It is never written to a `VITE_*` variable or bundled for the
  browser.
- Hosted schema, hosted email delivery, and production deployment were not tested
  or modified. Print/Word visual layout remains a manual check.

## Before any hosted rollout

The new migration has only been prepared/tested locally. Compare hosted schema
and policies first: hosted admin customizations were not available for review.
Do not run `db push` simply to obtain a test login.

For hosted password recovery, allow the deployed `/reset-password` URL in
Supabase Auth URL Configuration. Configure the organization's chosen SMTP
provider there; do not put SMTP/admin secrets in Vite environment variables.
The local inbox verifies the flow, not real external email delivery.

Permanent account deletion is still not implemented. It must account for the
existing cascading deletion of attendance records before it is considered.
