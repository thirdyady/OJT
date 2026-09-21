# Final integrity fixes

The approved attendance policy is: trainees can punch in order and undo only
their latest punch for the current Manila date. PostgreSQL supplies the punch
time. Historical corrections remain administrator operations. Completed days
with only one break timestamp continue to count as zero until corrected.

## Changes and preservation

- `20260921000000_attendance_integrity.sql` replaces trainee direct DTR writes
  with `dtr_punch`. It derives ownership from the authenticated session, locks
  the profile and today's row, checks active status and the client's expected
  punches, and generates the timestamp on the database server. No browser
  supplied user ID or punch timestamp is accepted. Existing administrator
  correction policies and the account deletion foreign key remain intact.
- `20260921000001_profile_validation_and_conflicts.sql` requires complete
  details for new registrations, including trusted account provisioning.
  Existing incomplete profiles remain usable. The administrator profile RPC
  requires the version (`updated_at`) that was displayed to the administrator.
  Trainee profile and target saves also compare the displayed version.
- Attendance and account lists use cursor pagination until an empty page, so
  the API row cap no longer silently truncates history or accounts. Any page
  failure rejects the load instead of presenting partial totals.
- Attendance dates, clocks and report times use `Asia/Manila`, regardless of
  the device timezone. Duration calculations continue using absolute timestamps.
- No existing attendance rows or calculated-hour rules are changed by these
  migrations. No hosted database was modified during implementation.

## Deployment order

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full production runbook and
environment/packaging checks.

Apply both migrations and release the matching application in one coordinated
maintenance window, then have users reload. Old clients fail safely after the
migrations: their direct trainee attendance writes and old profile RPC signature
are no longer accepted. Do not deploy the new browser bundle before its RPCs.
Do not restore the old broad trainee write policy as a workaround.

Take the deployment's normal backup first. Confirm production migrations, server
environment variables, Auth redirect allow-list and real SMTP delivery as
described in `AUTH_PRODUCTION.md`; local tests cannot verify hosted settings.

Administrators should inspect incomplete historical rows before issuing final
reports. This read-only query identifies completed days with an unmatched break:

```sql
SELECT id, user_id, entry_date, check_in, break_out, break_in, check_out
FROM public.dtr_entries
WHERE check_in IS NOT NULL AND check_out IS NOT NULL
  AND ((break_out IS NULL) <> (break_in IS NULL))
ORDER BY user_id, entry_date;
```

These records are preserved and continue to count as zero, as approved. Do not
automatically invent missing punches or alter historical dates to fix them.

## Verification

Run `npm run test:local`, `npm run test:e2e`, `npm run typecheck`, and
`npm run build`. The integrity tests exercise direct API abuse, duplicate and
stale punches, inactive sessions, profile conflicts, invalid signup, histories
larger than 1,000 rows, and device timezone differences. Existing recovery,
deletion, reporting and attendance-sequence regression tests remain in place.

Manual acceptance: complete and undo today's punches, try a stale second tab,
deactivate/reactivate a signed-in trainee, open the same report from a UTC
device, and attempt to save stale trainee details. Confirm that each rejected
write leaves the newer record intact.
