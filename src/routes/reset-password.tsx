import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/reset-password")({ component: ResetPasswordPage });

function ResetPasswordPage() {
  const linkError = useLocation({
    select: (location) => {
      const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
      const search = new URLSearchParams(location.searchStr);
      return (
        hash.get("error_description") ||
        search.get("error_description") ||
        (hash.has("error") || search.has("error")
          ? "This link is invalid or expired. Please request a new reset email."
          : "")
      );
    },
  });
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const saving = useRef(false);

  useEffect(() => {
    let active = true;
    setChecking(true);
    setDone(false);
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active && !linkError) setReady(Boolean(session));
    });
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        setReady(!linkError && !error && Boolean(data.session));
        setError(
          linkError ||
            error?.message ||
            (!data.session
              ? "This link is invalid or expired. Please request a new password reset email."
              : ""),
        );
        setChecking(false);
      })
      .catch(() => {
        if (active) {
          setError("Unable to verify your session. Please reload and try again.");
          setChecking(false);
        }
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [linkError]);

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
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
      setPassword("");
      setConfirm("");
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Unable to update your password. Try again.",
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
              Your password has been updated.
            </p>
            <Link to="/dashboard" className="underline">
              Continue to your dashboard
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
