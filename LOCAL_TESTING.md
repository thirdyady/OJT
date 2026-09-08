# Local development and milestone 2

This setup runs the existing frontend against a separate Supabase database on
your PC. It does not create hosted admin accounts or change hosted data.

## Start

From the `OJT` folder, with Docker Desktop running:

```powershell
npm ci
npm run local:start
npm run local:seed
npm run dev -- --strictPort
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
- Admins can view and update a selected trainee's required-hours target through a
  narrow protected RPC.
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
7. Sign in as the local admin. Select a trainee, cancel and accept a punch-clear
   confirmation, and test deletion on sample attendance. Test mobile width too.
8. Verify month/year filtering, CSV, print preview, and Word export still work.
   Yesterday's seeded sample is eight hours; select the previous month if today
   is the first of a month.
9. Open Sign up and verify Full Name, Student ID, Host Company, and OJT Title are
   required. Complete all four fields, register, and confirm the account-created
   message. Local confirmation links appear in the Supabase inbox.
10. To exercise legacy completion, create or use a profile with blank Student ID,
    Host Company, or OJT Title. The dashboard should still show the DTR controls
    and existing records. Fill every required field, save, and verify the prompt
    disappears. The admin trainee list should show the saved OJT Title.
11. In the trainee dashboard, enter a target such as `486` in Required hours and
    click Save target. Verify Required, Completed, Remaining, and Complete values.
    Change the DTR month and confirm cumulative Completed stays based on all
    months while the monthly DTR total changes.
12. Sign in as admin, select a trainee, change Required OJT hours, and click Save
    target. Return to the trainee account and verify the new target is shown.
    Set a target equal to or below completed hours to see the completion message;
    the progress bar caps at 100% while any overage is stated in the message.

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
role escalation, and admin target updates. Progress calculation tests cover
complete/incomplete days, breaks, multiple months, exact completion, and
over-target completion. Browser tests cover attendance persistence, network
failure, confirmations, CSV download, admin access, password recovery, profile
completion, and target editing.

## Validation recorded on September 8, 2026

- Production build and TypeScript checks passed.
- Lint passed for all changed application code, scripts, tests, and generated
  database types. The full-repository lint command still reports pre-existing
  formatting/line-ending issues and component-export warnings in untouched files.
- Local database access and progress calculation regression passed (8 tests),
  including role-escalation and admin-target checks.
- Browser workflows passed: attendance/admin management, password recovery, new
  registration metadata, and legacy profile completion. The attendance workflow
  also checks failed profile saves and stale-tab conflicts.
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

This milestone does not implement account creation/deactivation/deletion in the
admin UI. Those remain later proposal stages. In particular, permanent account
deletion must account for the existing cascading deletion of attendance records.
