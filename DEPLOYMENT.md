# PSA DTR deployment runbook

This is a TanStack Start application with Nitro server functions, not a static
SPA. Vercel configuration is present, so Vercel is the primary path below. A
Node server is an alternative. No production deployment, production database
changes, or real SMTP delivery were performed during this review.

## 1. Deployment checklist

- [ ] Review and commit the complete release, including both September 21
  migrations, the new server/helpers/tests, deployment guards, and documentation.
  The workspace contains changes from multiple milestones; deploying only the
  dashboard or only the migrations is not a complete release.
- [ ] Select the real production Supabase project and canonical HTTPS domain.
  `supabase/config.toml` contains local Auth settings; its project ID is not
  proof that the intended hosted project is linked or correctly configured.
- [ ] Take a restorable backup and record existing profile/DTR counts. Rehearse
  migrations on staging. Keep preview/staging credentials separate from production.
- [ ] Set host environment variables below and finish the Supabase dashboard steps.
- [ ] Require the `Deployment safety / credentials` CI job through branch
  protection/rulesets. That job is added to this repository; the hosted ruleset
  must still be configured by the repository owner.
- [ ] Run `npm ci`, `npm run test:deployment`, `npm run check:deployment`,
  `npm run typecheck`, `npm run test:local`, and `npm run test:e2e` locally/CI.
  Database/browser suites use isolated **local** Supabase, never production.
- [ ] Run `npm run build`. Its prebuild checks Git/source files and public env
  exposure; its postbuild scans deployable artifacts. Existing bundle-size and
  tsconfig-plugin warnings are non-blocking.
- [ ] Coordinate the migration and matching app release in a maintenance window.
- [ ] Finish the production smoke checks below before opening normal attendance use.

### Hosting/build configuration

For Vercel, select the directory containing this `package.json` as Root Directory
(`OJT` if the hosting repository wraps this folder; `.` if OJT itself is the Git
root). Use the **TanStack Start** framework preset. `vercel.json` explicitly uses
`npm ci` and `npm run check:production-env && npm run build`. Both `bun.lock` and
`package-lock.json` exist; explicit npm installation avoids unintended lockfile
selection. Neither lockfile was deleted.

Use a supported Node version at least **22.12**; Node 22's current patch is the
CI baseline. Installed TanStack Start requires this minimum. Build on the host's
OS/architecture rather than uploading a Windows build to a Linux runtime.

Leave Output Directory at the framework default. Do not configure `dist`, add a
catch-all rewrite to `index.html`, or deploy only `.output/public`: account
creation and deletion need the server functions. Nitro selects its Vercel output
on Vercel; a normal local build uses `.output/server/index.mjs`. For Node hosting,
deploy the generated `.output` tree and run `node .output/server/index.mjs` with
the server environment injected. Terminate HTTPS at the host/proxy and do not
serve the source checkout as a document root. `npm run local:dev`, `npm run dev`,
`build:dev`, and `preview` are not production server commands.

See [Vercel's TanStack Start guide](https://vercel.com/kb/guide/deploy-a-tanstack-start-app-to-vercel).

### Local files and credentials

- `.local-test-accounts*`, real `.env*` files, test reports/traces, Vercel state,
  and Supabase temporary metadata are ignored by Git. Safe `*.example` templates
  remain trackable.
- `.env` previously contained public project settings and an anon key. It and
  `supabase/.temp/cli-latest` were removed from Git's index **without deleting the
  local files**. This does not rewrite Git history. No privileged key was found
  in the inspected tracked `.env`.
- `.vercelignore` separately excludes workstation environment files, test-account
  files, local runners, reports, and generated local builds from Vercel uploads.
  Runtime code, assets, build tooling, package-lock, and migrations are retained.
- `check:deployment` reads the Git index, catches forbidden force-staged paths
  and recognizable privileged keys, and scans `public`. `postbuild` also scans
  `.output` and `.vercel/output` for forbidden files, recognizable keys, and known
  environment/test-account credential values. Findings report paths, not secrets.
- Ignore files stop ordinary accidental staging; they cannot make deliberate
  bypass impossible. Require CI, do not use `git add -f` for credentials, and do
  not bypass npm build hooks. Secret scanners cannot recognize every arbitrary
  renamed/encoded credential. Use host/organization secret storage.

Read [Vercel's exclusion-file documentation](https://vercel.com/docs/deployments/vercel-ignore).

## 2. Required environment variables

Use `.env.production.example` as a **template**, not as a deployable credentials
file. Production values belong in the hosting dashboard/secret manager.

| Variable | When required | Contents / exposure |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Build | Production project's HTTPS API URL; public |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Build | Same project's publishable key or legacy anon JWT; public |
| `SUPABASE_URL` | Server runtime; Vercel build check | Same URL as the browser uses |
| `SUPABASE_PUBLISHABLE_KEY` | Server runtime; Vercel build check | Same project's public key for authenticated server requests |
| `SUPABASE_SERVICE_ROLE_KEY` | Server runtime; Vercel build check | Same project's service-role JWT or secret key; **server-only secret** |
| `PUBLIC_SITE_URL` | Optional, recommended | Canonical HTTPS app origin for non-browser redirect fallback |

Vite embeds `VITE_*` values into browser assets. Rebuild after changing them;
runtime changes alone cannot redirect an already-built browser bundle. Never
prefix an admin, SMTP, database, or provider credential with `VITE_`.

The `*_PROJECT_ID` entries in the old `.env` are not used by application code and
are not required. Node hosting may also require the provider's `PORT`/`HOST`
settings. `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD` are optional CLI/CI
secrets for migration operators, **not application variables**. SMTP credentials
are configured in Supabase, not in this app.

Run `npm run check:production-env` inside the configured build environment. It
rejects missing/placeholder keys, localhost/non-HTTPS endpoints, mismatched URLs,
and secret browser variables. It does not authenticate the keys or verify that
an opaque key belongs to the selected project; the deployment smoke test does.
The local checkout is intentionally missing a production service-role key.

## 3. Supabase dashboard steps

1. Open the intended hosted project. Confirm the project reference and copy its
   API URL/public key/server key into the correct hosting environment scopes.
2. In Authentication URL Configuration, set Site URL to the canonical origin,
   e.g. `https://dtr.example.gov.ph`. Add exact allowed destinations:
   - `https://dtr.example.gov.ph`
   - `https://dtr.example.gov.ph/reset-password?flow=recovery`
   Use the actual domain. Keep localhost in the local project. Prefer a separate
   staging project for previews; do not allow arbitrary preview domains/global
   wildcards to use production Auth. If an alternate host is used, either redirect
   it to the canonical host before Auth or explicitly allow its exact destinations.
3. Keep email confirmation enabled for public registrations. Keep email templates'
   `{{ .ConfirmationURL }}` verification link. A bare `{{ .RedirectTo }}` link is
   not a substitute: it would skip the Auth verification step. Custom links must
   retain the verification token/type and the intended redirect.
4. Enable custom SMTP. With Resend, use a verified sending domain, From address,
   `smtp.resend.com`, username `resend`, and the Resend API key as password. Select
   a provider-supported TLS port (587/STARTTLS is typical). Configure the required
   DNS verification records and your organization's DMARC policy. Keep link
   tracking off for Auth messages. Send real confirmation and recovery emails.
5. Review Auth rate limits and password requirements. Do not enable CAPTCHA or
   other Auth requirements without staging tests: the current forms do not supply
   CAPTCHA tokens. This is not a request to change public signup behavior.
6. Review Security Advisor, RLS on `profiles`/`dtr_entries`, and backup/restore
   availability. Confirm only approved accounts have `is_admin=true` and are active.
   Never run `local:seed` or import `.local-test-accounts.json` into production.

Sources: [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls),
[SMTP requirements](https://supabase.com/docs/guides/auth/auth-smtp),
[Resend SMTP](https://resend.com/docs/send-with-smtp),
[production checklist](https://supabase.com/docs/guides/deployment/going-into-prod).
The default Supabase mail service is not a production delivery solution for
ordinary trainee addresses; external SMTP is a release requirement here.

## 4. Migration steps

These commands are an operator runbook, not commands executed against production
during this review. Use a pinned/reviewed Supabase CLI version for the release.

```text
supabase login
supabase link --project-ref ACTUAL_PRODUCTION_PROJECT_REF
supabase migration list --linked
supabase db push --linked --dry-run
```

Do not infer the target from the checked-in local config. Compare the linked
project reference, migration history, and actual schema. The repository has ten
migrations, in order:

```text
20260721004037  original profiles/DTR tables
20260721004055  trigger function permissions
20260908000000  admin access/RLS
20260908000001  profile completeness/OJT title
20260908000002  required OJT hours
20260909000000  administrator profile editing
20260909000001  active/inactive enforcement
20260910000000  safe unused-account deletion / DTR RESTRICT FK
20260921000000  server-time attendance RPC / trainee write restrictions
20260921000001  registration validation / profile version checks
```

If the earlier eight are already applied, the dry run should show only the last
two. If an existing production database has tables but missing migration history,
stop and reconcile the baseline with its owner; do not replay CREATE TABLEs or
mark migrations applied without proving the schema matches. Investigate drift
before proceeding. Do not use `db reset`, `--include-seed`, or local seed scripts.

After staging rehearsal, backup, and maintenance coordination:

```text
supabase db push --linked
supabase migration list --linked
```

Apply all genuinely pending migrations in order, then immediately release the
matching application and reload clients. Old clients' direct attendance writes
and old profile-RPC signature fail safely after the new migrations.

Verify `dtr_entries.user_id -> auth.users.id` uses **ON DELETE RESTRICT**, RLS is
enabled, trainees have SELECT but no direct DTR writes, `dtr_punch` is available
to authenticated sessions, and `dtr_delete_unused_trainee` is service-role-only.
Check profile/DTR counts against the pre-deployment snapshot. Inspect unmatched
breaks using the read-only query in `FINAL_HARDENING.md`; the approved behavior is
zero hours until corrected, without rewriting historical records.

See [Supabase migration workflow](https://supabase.com/docs/guides/local-development/cli-workflows).

## 5. Verification after deployment

Use controlled production smoke-test accounts approved by the operator. Do not
run the destructive fixture-cleanup test suite against the hosted project.

- [ ] Load `/`, `/auth`, and a direct `/dashboard` URL; verify HTTPS, routing and
  hydration. Browser requests must use the correct hosted Supabase URL.
- [ ] Register with complete details, receive/confirm a real email, and sign in.
- [ ] Request recovery; test a valid, expired, and already-used link. Successful
  recovery requires sign-in again; normal Change password keeps the session.
- [ ] Complete all four punches and undo confirmations. Check the persisted
  Manila date/server timestamps, a stale second tab, and duplicate-click handling.
- [ ] As admin, create/edit a trainee and confirm a stale profile save is rejected.
  A trainee must be unable to invoke privileged endpoints or read other accounts.
- [ ] Deactivate an already-signed-in trainee; verify protected writes fail and
  history remains. Reactivate and confirm access returns.
- [ ] Verify account deletion is blocked when any DTR row exists. Test permanent
  deletion only on a deliberately unused smoke account after reviewing its ID.
- [ ] Compare monthly table, CSV, print, Word, and OJT totals, including a UTC
  device and the oldest available history. Do not delete real attendance to test.
- [ ] Confirm `/.env`, `/.local-test-accounts.json`, and `/test-results/` do not
  return file contents (normally 404). Review deployment files and browser assets
  for credentials; review server/Auth logs for failures without copying tokens.
- [ ] Verify runtime account-creation/deletion calls succeed: a static-page-only
  smoke test does not prove the privileged server is configured correctly.

## 6. Rollback considerations

- Prefer a forward fix or a previous **schema-compatible** application release.
  Rolling back to the old client alone will not restore writes: the old client
  uses direct DTR mutations and the superseded profile RPC.
- Keep `ON DELETE RESTRICT`, active-account RLS, role protections, and the narrow
  attendance RPC. Do not restore broad trainee writes or cascading history loss
  merely to make an old client work.
- If the app is broken, keep maintenance mode and preserve data while restoring
  a compatible server/client build. Treat each migration separately: an earlier
  migration may have committed even if a later migration failed.
- A full database restore can discard attendance recorded after the backup.
  Capture/reconcile those changes and obtain operator approval before restoring.
  Auth identities/sessions and application rows must remain consistent; Storage
  and SMTP/host settings may require their own recovery procedure.
- Environment/SMTP/redirect changes are separate from SQL migrations. Record the
  previous settings securely. If any secret leaks, rotate it and redeploy rather
  than assuming Git removal or application rollback revokes it.

No data files were deleted. The only index removals were `.env` and generated
Supabase CLI metadata; both local copies remain available.

## Review verification

- Final `npm run build`: passed, including prebuild source/index checks and
  postbuild artifact scans. Existing chunk-size/plugin advisories remain.
- `npm run test:deployment`: four tests passed, including an executable test
  proving force-staged credentials and public copies are rejected.
- Targeted deployment-script ESLint and `git diff --check`: passed.
- `npm run check:production-env` on this workstation: correctly failed because
  `SUPABASE_SERVICE_ROLE_KEY` is not configured. Set it in the host's secret
  environment; do not add it to the repository or send it through chat.
- Hosted dashboard settings, linked production migration history, actual Vercel
  runtime, and external SMTP delivery remain operator verification steps.
- Nitro is currently a pinned pre-release dependency (`3.0.260603-beta`); the
  staging runtime smoke test is especially important. No dependency upgrade was
  introduced as part of this deployment review.
