# Functional review — 9 September 2026

## Fix follow-up

The three findings below have now been addressed in `src/routes/_authenticated/dashboard.tsx`:

- Print and Word templates escape trainee names. Print iframes allow printing but prohibit scripts.
- Profile-save responses update the shared editor only if its selection version still matches. Status feedback has the same protection; account creation invalidates earlier attendance-load responses.
- Monthly tables, CSV exports, and OJT progress now use the same validated completed-hours calculation. Incomplete break pairs contribute zero until corrected; month filtering remains separate.

`tests/e2e/review-regressions.spec.ts` adds regression coverage for malicious names in print/Word exports, switching accounts during a delayed save, and clearing a break followed by checking admin totals, trainee progress, and CSV output. No database migration or design change was needed. The original review below is retained as the record of the findings before these fixes.

Fix validation: TypeScript, production build, targeted ESLint, and `git diff --check` passed. All 8 local database/calculation tests and all 6 existing browser workflows passed. All 3 new browser regression tests passed after correcting an ambiguous test-account selector. Browser tests reused the verified local development server; the temporary configuration was removed. Existing build advisories remain. Hosted deployment and physical print output were not tested.

Manual checks using local test accounts:

1. Admin: save trainee A with browser network throttling enabled, select B before the save finishes, and confirm B's fields remain B's.
2. Admin: print/export a local trainee whose name includes ordinary special characters such as `O'Neil & Co <Intern>`. Confirm the name appears literally and the print dialog still works.
3. Admin: clear Break In on a completed local test day. Confirm its monthly total becomes zero. Sign in as that trainee and confirm OJT progress and CSV exclude that incomplete day too.

Reviewed the current implementation against Luna's pasted milestone handoffs and the PSA enhancement proposal. The documents were treated as reference material, not new implementation instructions. Visual design was excluded. No application code, migrations, or hosted data were changed.

## Verdict

The main milestone workflows work locally, but passing the existing tests does not establish that everything is correct. Three defects were reproduced and should be addressed before rollout.

## Findings, ordered by priority

### High: printed trainee names can execute scripts

`src/routes/_authenticated/dashboard.tsx:209`, `:233`, and `:295` interpolate `fullName` directly into HTML and assign it to an unsandboxed iframe's `srcdoc`. A trainee-controlled name containing HTML can therefore execute JavaScript when an administrator prints their DTR, in the application's origin with access to the parent page. Word export also interpolates names directly.

Verification: extracted the actual print builder from the source and rendered its output in an isolated blank browser page. A harmless name containing a script set a marker on the parent page. No credentials were accessed and no malicious name was saved to the database.

This vulnerability already exists in the Git HEAD implementation; it is not newly introduced by Luna's current diff, but remains relevant to functional/security readiness.

Suggested fix: HTML-escape all profile text in generated documents, or build text nodes. Add iframe sandboxing as defense in depth with the permissions actually needed for printing. Add a regression test confirming names remain literal text and cannot execute scripts.

### High: delayed admin saves populate the wrong trainee's form

`src/routes/_authenticated/dashboard.tsx:1707` unconditionally applies returned profile fields to the current editor. The account list remains usable while a profile save is pending (`:1996` disables it only for attendance mutations).

Verification: with temporary local accounts, started saving trainee A, delayed the RPC response, selected trainee B, then released A's response. B remained selected but the Full Name input became `Review A Edited`. The other editor fields and target are likewise overwritten. Saving again can copy A's details onto B's database profile.

Suggested fix: bind save responses to the selected account/request version and ignore stale editor updates, or block account switching while saving. Apply the same selection safeguards to account creation and status feedback. Test delayed responses with account switching.

### Medium: monthly totals and OJT progress disagree after clearing a break

`src/routes/_authenticated/dashboard.tsx:105` counts the full check-in/check-out interval if only one break timestamp remains. `src/lib/ojt-progress.mjs:8` correctly excludes that incomplete record. Administrators can produce this state using the existing individual punch-clear buttons.

Verification with the actual functions: 08:00 check-in, 12:00 break-out, missing break-in, and 17:00 check-out produces **9 monthly/CSV hours but 0 completed OJT hours**.

Suggested fix: use one validated duration function for monthly totals, CSV, and cumulative progress, while retaining separate month filtering. Define a safe correction workflow for incomplete/invalid punch sequences. Test clearing each punch from a completed day. The older monthly calculation is inherited; the disagreement appears with the new progress calculation.

## Validation performed

- `npm run typecheck`: passed.
- `npm run test:local`: 8 passed — 2 database/workflow tests and 6 calculation tests. RLS isolation, protected role/status changes, admin editing, deactivation with an existing session, reactivation, and signup metadata passed.
- `npm run build`: passed; large-client-chunk and tsconfig-path advisory warnings remain.
- Existing browser suite: 6 passed. The standard command initially stopped because port 3000 was occupied. Verified that the running app uses `http://127.0.0.1:54321`, then ran the suite with a temporary config permitting reuse of that server. This verifies the running local development app, not a deployed production instance.
- Browser bundle scan: no local service-role key, `SUPABASE_SERVICE_ROLE_KEY`, `supabaseAdmin`, or privileged account-creation call found. Generic `sb_secret_` checks in bundled Supabase code are not secret values.
- Additional focused probes reproduced all three findings above. Temporary local accounts were cleaned up; temporary probe/config files were removed.
- Full-repository lint was not rerun: this review made no application edits, and the handoff already identifies extensive formatting diagnostics. This does not independently certify that those diagnostics are all pre-existing.

## Coverage limits and next suggestions

- Add account-creation tests for duplicate email, invalid server input, unauthenticated/inactive callers, profile-setup failure, and failed rollback. Existing browser coverage proves successful creation and trainee denial; it does not exercise rollback. The server's authorization and service-role separation look appropriate in the reviewed code.
- Tighten required-field validation: public signup relies on HTML `required`, then trims strings. Whitespace-only input can become empty metadata. The profile-edit RPC also converts blank required fields to null. Preserve incomplete legacy profiles while enforcing meaningful new input at the appropriate trusted boundary.
- Paginate account/history reads or calculate lifetime totals on the server. Current unpaginated reads are subject to API row limits, so sufficiently large histories/account lists can be truncated.
- For stronger attendance integrity, consider server-assigned punch times and database enforcement of valid sequences; current active trainees have direct write access to their own attendance and client-supplied timestamps. This is an inherited limitation beyond accidental-click safeguards.
- The server runtime/deployment configuration changed substantially for account creation. Validate a production-like server deployment and its server-only environment variables before rollout; a successful build is not deployment verification.
- External SMTP and permanent account deletion are still unimplemented/deferred. Hosted migrations, real email delivery, production deployment, and print/Word layout were not validated here. These are remaining proposal work, not features Luna claimed to have completed in Milestone 4.

Suggested order: resolve printed-name script execution, fix account-selection races, reconcile attendance calculations, then add failure-path coverage before deployment. Visual design can remain deferred.
