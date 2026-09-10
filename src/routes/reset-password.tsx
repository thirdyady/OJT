import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  clearPasswordRecoveryEvent,
  getPasswordRecoverySession,
  supabase,
  updateRecoveryPassword,
} from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({ component: ResetPasswordPage });

const INVALID_RECOVERY_MESSAGE =
  "This reset link is invalid or expired. Please request a new password reset email.";

type AuthLinkDetails = {
  linkError: string;
  recoveryIntent: boolean;
};

function getAuthLinkDetails(hashValue: string, searchValue: string): AuthLinkDetails {
  const hash = new URLSearchParams(hashValue.replace(/^#/, ""));
  const search = new URLSearchParams(searchValue);
  const errorDescription = hash.get("error_description") || search.get("error_description");
  const errorCode = hash.get("error_code") || search.get("error_code");
  const errorType = hash.get("error") || search.get("error");
  const linkError = errorDescription || (errorCode || errorType ? INVALID_RECOVERY_MESSAGE : "");
  const flowType = hash.get("type") || search.get("type");
  const hasRecoveryToken = hash.has("access_token") || search.has("access_token");
  const recoveryIntent =
    flowType === "recovery" ||
    (!flowType && hasRecoveryToken) ||
    search.get("flow") === "recovery" ||
    search.has("code") ||
    Boolean(linkError);

  return { linkError, recoveryIntent };
}

function ResetPasswordPage() {
  const { linkError, recoveryIntent } = useLocation({
    select: (location) => getAuthLinkDetails(location.hash, location.searchStr),
  });
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [flow, setFlow] = useState<"recovery" | "change" | null>(null);
  const saving = useRef(false);
  const recoveryEventReceived = useRef(false);
  const recoverySession = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    let recoveryFallback: ReturnType<typeof setTimeout> | undefined;
    recoveryEventReceived.current = false;
    recoverySession.current = null;
    if (!recoveryIntent) clearPasswordRecoveryEvent();
    setChecking(true);
    setReady(false);
    setDone(false);
    setFlow(linkError || recoveryIntent ? "recovery" : null);
    setError(linkError);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;

      if (event === "PASSWORD_RECOVERY") {
        recoverySession.current = getPasswordRecoverySession(session);
        recoveryEventReceived.current = true;
        setFlow("recovery");
        if (linkError || !recoverySession.current) {
          setReady(false);
          setError(linkError || INVALID_RECOVERY_MESSAGE);
        } else {
          setReady(true);
          setError("");
        }
        setChecking(false);
        return;
      }

      if (
        !session ||
        ((recoveryIntent || recoveryEventReceived.current) &&
          (!getPasswordRecoverySession(session) ||
            (recoverySession.current &&
              getPasswordRecoverySession(session) !== recoverySession.current)))
      ) {
        recoverySession.current = null;
        recoveryEventReceived.current = false;
        setReady(false);
        setPassword("");
        setConfirm("");
        setError(
          recoveryIntent ? INVALID_RECOVERY_MESSAGE : "Sign in before changing your password.",
        );
        setChecking(false);
        return;
      }

      // A regular signed-in session is sufficient for the intentional
      // change-password screen, but never substitutes for a recovery session.
      if (!recoveryIntent && session) {
        setFlow("change");
        setReady(true);
        setError("");
        setChecking(false);
      }
    });

    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active) return;

        if (linkError) {
          setReady(false);
          setFlow("recovery");
          setError(linkError);
          setChecking(false);
          return;
        }

        if (sessionError) {
          setReady(false);
          setError(recoveryIntent ? INVALID_RECOVERY_MESSAGE : sessionError.message);
          setChecking(false);
          return;
        }

        if (!recoveryIntent && data.session) {
          setFlow("change");
          setReady(true);
          setError("");
          setChecking(false);
          return;
        }

        if (!recoveryIntent) {
          setReady(false);
          setError("Sign in before changing your password.");
          setChecking(false);
          return;
        }

        // Supabase emits PASSWORD_RECOVERY after it exchanges a valid recovery
        // link. Do not treat a pre-existing session as proof that this link is
        // valid. The short fallback gives that event time to arrive, then
        // reports an invalid/expired session instead of showing the form.
        setFlow("recovery");
        setChecking(false);
        const recoverySessionMatchesMarker = getPasswordRecoverySession(data.session);
        if (!recoveryEventReceived.current && recoverySessionMatchesMarker) {
          // The client-level listener saw the recovery event before this page
          // mounted. Match both user and session, so an ordinary later login
          // cannot reuse an old recovery marker, even for the same account.
          recoveryEventReceived.current = true;
          recoverySession.current = recoverySessionMatchesMarker;
          setReady(true);
          setError("");
        } else if (!recoveryEventReceived.current && !data.session) {
          setReady(false);
          setError(INVALID_RECOVERY_MESSAGE);
        } else if (!recoveryEventReceived.current) {
          setReady(false);
          recoveryFallback = setTimeout(() => {
            if (active && !recoveryEventReceived.current) {
              setError(INVALID_RECOVERY_MESSAGE);
              setReady(false);
            }
          }, 1000);
        }
      })
      .catch(() => {
        if (active) {
          setError(
            recoveryIntent
              ? INVALID_RECOVERY_MESSAGE
              : "Unable to verify your session. Please reload and try again.",
          );
          setReady(false);
          setChecking(false);
        }
      });

    return () => {
      active = false;
      if (recoveryFallback) clearTimeout(recoveryFallback);
      subscription.unsubscribe();
    };
  }, [linkError, recoveryIntent]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving.current || !ready) return;
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      if (
        flow === "recovery" &&
        (!data.session ||
          !recoverySession.current ||
          getPasswordRecoverySession(data.session) !== recoverySession.current)
      ) {
        setReady(false);
        throw new Error(INVALID_RECOVERY_MESSAGE);
      }
      const { error: updateError } =
        flow === "recovery"
          ? await updateRecoveryPassword(data.session!, password)
          : await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      if (flow === "recovery") {
        // Require an explicit sign-in after a recovery update instead of
        // silently leaving the one-time recovery session active.
        const current = await supabase.auth.getSession();
        if (
          getPasswordRecoverySession(current.data.session) === recoverySession.current &&
          recoverySession.current
        )
          await supabase.auth.signOut();
        clearPasswordRecoveryEvent();
      }
      setDone(true);
      setReady(false);
      setPassword("");
      setConfirm("");
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : "";
      const sessionFailure = /session|token|jwt|expired|invalid/i.test(message);
      setError(
        flow === "recovery" && sessionFailure
          ? INVALID_RECOVERY_MESSAGE
          : message || "Unable to update your password. Try again.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <section className="w-full max-w-md space-y-4 rounded-xl border bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold">Set a new password</h1>
        {checking ? (
          <p role="status">Checking your link…</p>
        ) : done ? (
          <>
            <p role="status" className="text-emerald-700">
              {flow === "recovery"
                ? "Your password has been updated. Sign in with your new password."
                : "Your password has been updated."}
            </p>
            <Link to={flow === "recovery" ? "/auth" : "/dashboard"} className="underline">
              {flow === "recovery" ? "Back to sign in" : "Continue to your dashboard"}
            </Link>
          </>
        ) : (
          <>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            {ready && (
              <form onSubmit={submit} className="space-y-4">
                <label className="block text-sm">
                  New password
                  <input
                    className="mt-1 w-full rounded border p-2"
                    type="password"
                    autoComplete="new-password"
                    minLength={6}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <label className="block text-sm">
                  Confirm new password
                  <input
                    className="mt-1 w-full rounded border p-2"
                    type="password"
                    autoComplete="new-password"
                    minLength={6}
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={busy}
                  />
                </label>
                <button
                  className="w-full rounded bg-slate-900 p-2 text-white disabled:opacity-50"
                  disabled={busy}
                >
                  {busy ? "Saving…" : "Update password"}
                </button>
              </form>
            )}
            <Link to="/auth" className="block text-sm underline">
              Back to sign in
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
