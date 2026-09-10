# Authentication production setup

Milestone 5 keeps password recovery and change password in the browser Supabase
client. The browser sends only the public Supabase URL and publishable key. The
recovery page accepts a reset link only after Supabase emits a
`PASSWORD_RECOVERY` session event; a normal signed-in session is used only for
the intentional Change password link. Expired links, missing sessions, and
failed updates show an actionable error. After a successful email recovery the
temporary recovery session is signed out and the user signs in again with the
new password. A normal Change password update keeps the existing session.

Recovery markers contain only user/session IDs, never tokens, and are cleared
on sign-out or a different session. The page rechecks the marker before saving;
the recovery write uses an isolated, non-persistent client pinned to that
session so a concurrent account switch cannot change the wrong password.
Reloading or refreshing tokens within the same recovery session remains valid.

Regression checks: open recovery in one tab, then sign out and sign in from
another tab (test both the same account and another account). The original
reset form must disappear and remain unavailable after reload. Also confirm a
valid recovery survives refresh/reload and a normal Change password keeps the
user signed in. These scenarios are covered in `tests/e2e/workflows.spec.ts`.

## Supabase Auth dashboard

In **Authentication → URL Configuration**:

1. Set **Site URL** to the canonical production origin, for example
   `https://dtr.example.gov.ph`.
2. Add the exact production recovery path:
   `https://dtr.example.gov.ph/reset-password?flow=recovery`.
3. Add the local path while local testing is needed:
   `http://localhost:3000/reset-password?flow=recovery`.
4. Add the production and local origins if email confirmation is enabled,
   because signup redirects to the app origin:
   `https://dtr.example.gov.ph` and `http://localhost:3000`. Add an exact
   preview URL or a narrowly scoped preview wildcard ending in `/**` only when
   the deployment uses previews.
5. Do not add arbitrary origins or a global `*` wildcard. Supabase checks each
   `redirectTo` value against this allow-list.

The app derives redirects from the origin serving it, so the same build works on
localhost, a preview host, and the canonical domain. Every origin that can host
the app still needs to be explicitly allow-listed in Supabase. See the
[Supabase redirect URL guide](https://supabase.com/docs/guides/auth/redirect-urls).

Keep the reset email template's `{{ .ConfirmationURL }}` unless a custom
template is required. If a custom template constructs its own destination, use
`{{ .RedirectTo }}` so the redirect passed by the app is retained. See
[Supabase email templates](https://supabase.com/docs/guides/auth/auth-email-templates).

## Resend SMTP

SMTP is configured outside this repository:

1. Verify the sending domain in Resend and publish its DKIM, SPF, and DMARC
   records. Use a domain and From address that the organization controls.
2. In **Supabase Dashboard → Authentication → SMTP**, enable custom SMTP and
   enter the Resend SMTP host (`smtp.resend.com`), the provider's supported
   port (587 is the usual STARTTLS choice), username (`resend`), the Resend API
   key as the SMTP password, and the verified From address/name.
3. Keep link tracking disabled for authentication messages so reset URLs are
   not rewritten or consumed by scanners. Review Auth email rate limits and
   CAPTCHA settings before launch.
4. Send a real confirmation and recovery message to a controlled mailbox and
   open the links on the deployed domain.

The Resend API key/SMTP password belongs in the Supabase dashboard or an
organization secret manager. Never put it in `VITE_*`, `.env`, source control,
or browser code. See Resend's [SMTP credentials](https://resend.com/docs/send-with-smtp)
and Supabase's [custom SMTP guide](https://supabase.com/docs/guides/auth/auth-smtp)
for provider settings and production limits of the default mailer.

## Environment variables

| Runtime                             | Variables                                            | Exposure                        |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------- |
| Browser build                       | `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` | Public by design                |
| Optional server URL fallback        | `PUBLIC_SITE_URL`                                    | Public URL only; never a secret |
| Existing server functions           | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`           | Server runtime only             |
| Existing privileged server function | `SUPABASE_SERVICE_ROLE_KEY`                          | Server secret only              |
| SMTP                                | Resend/Supabase dashboard settings                   | Never part of this app's env    |

Production should provide the public browser values through the hosting
provider's environment settings. Do not copy the local service-role value from
`npm run local:dev` into a Vite variable. The service-role key is only used by
the existing server-side admin account function.

## Local email testing

Keep the local Supabase stack and Mailpit configuration unchanged. Run:

```powershell
npm run local:start
npm run local:seed
npm run local:dev
```

Open the Mailpit URL printed by `npx --yes supabase status`, request a reset
from `http://localhost:3000/auth`, and open the captured link. Local mail is
captured and never sent through Resend. The local redirect must remain
`http://localhost:3000/reset-password?flow=recovery` in the local Supabase
allow-list.

For a deployment smoke test, repeat the same flow on the production origin,
verify that an expired or already-used link cannot show the password form, and
confirm that a successful recovery returns to sign-in before the new password
is accepted.
