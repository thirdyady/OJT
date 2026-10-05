import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  RECOVERY_REQUEST_MESSAGE,
  recoveryWaitSeconds,
  startRecoveryCooldown,
} from "@/lib/password-recovery";
import { accountLabels } from "@/lib/account-progress.mjs";
import type { Enums } from "@/integrations/supabase/types";
import { supabase, getPasswordRecoverySession } from "@/integrations/supabase/client";
import { getEmailConfirmationRedirectUrl, getPasswordRecoveryRedirectUrl } from "@/lib/auth-urls";
import { useRecoveryRedirect } from "@/hooks/use-recovery-redirect";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · PSA DTR" },
      {
        name: "description",
        content: "Sign in to review and record your attendance.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  useRecoveryRedirect();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [company, setCompany] = useState("");
  const [ojtTitle, setOjtTitle] = useState("");
  const [accountType, setAccountType] = useState<Enums<"account_type">>("ojt");
  const [requiredDays, setRequiredDays] = useState("");
  const submitting = useRef(false);
  const [recoveryWait, setRecoveryWait] = useState(0);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (getPasswordRecoverySession(data.session))
        navigate({ to: "/reset-password", search: { flow: "recovery" } });
      else if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  useEffect(() => {
    if (mode !== "forgot") return;
    const update = () => setRecoveryWait(recoveryWaitSeconds());
    update();
    const timer = window.setInterval(update, 1000);
    window.addEventListener("storage", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("storage", update);
    };
  }, [mode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    if (mode === "forgot" && recoveryWaitSeconds() > 0) {
      setRecoveryWait(recoveryWaitSeconds());
      return;
    }
    submitting.current = true;
    setLoading(true);
    setMsg(null);
    try {
      if (mode === "forgot") {
        startRecoveryCooldown();
        setRecoveryWait(recoveryWaitSeconds());
        // Do not disclose account-specific Auth/SMTP failures or throttling.
        // The same response and cooldown apply to every valid email address.
        try {
          await supabase.auth.resetPasswordForEmail(email.trim(), {
            redirectTo: getPasswordRecoveryRedirectUrl(),
          });
        } catch {
          /* Delivery is deliberately not claimed or confirmed here. */
        }
        setMsg({ kind: "info", text: RECOVERY_REQUEST_MESSAGE });
      } else if (mode === "signup") {
        if (
          ![fullName, company, ojtTitle, ...(accountType === "ojt" ? [studentId] : [])].every(
            (value) => value.trim(),
          )
        ) {
          throw new Error("Complete all required account details. Spaces alone are not valid.");
        }
        if (
          accountType === "processing" &&
          (!/^[1-9][0-9]*$/.test(requiredDays) || Number(requiredDays) > 2147483647)
        ) {
          throw new Error("Required workdays must be a positive whole number.");
        }
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: getEmailConfirmationRedirectUrl(),
            data: {
              full_name: fullName.trim(),
              student_id: accountType === "ojt" ? studentId.trim() : null,
              account_type: accountType,
              required_workdays: accountType === "processing" ? Number(requiredDays) : null,
              company: company.trim(),
              ojt_title: ojtTitle.trim(),
            },
          },
        });
        if (error) throw error;
        setMsg({
          kind: "info",
          text: "Account created. Check your email to confirm, then sign in.",
        });
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        navigate({ to: "/dashboard" });
      }
    } catch (err) {
      setMsg({
        kind: "error",
        text: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        <div>
          <div className="mb-6 text-center">
            <Link
              to="/"
              className="rounded text-sm font-medium text-blue-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-900"
            >
              Back to home
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">
              {mode === "forgot"
                ? "Reset your password"
                : mode === "signin"
                  ? "Sign in to your DTR"
                  : "Create your account"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {mode === "forgot"
                ? "Enter your registered email to request a reset link."
                : mode === "signin"
                  ? "Enter your email and password to continue."
                  : "Select your account type and complete your details below."}
            </p>
          </div>

          <form
            onSubmit={submit}
            className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            {mode === "signup" && (
              <>
                <Field label="Account type">
                  <select
                    className="input"
                    disabled={loading}
                    value={accountType}
                    onChange={(e) => {
                      setAccountType(e.target.value as Enums<"account_type">);
                      setMsg(null);
                    }}
                  >
                    {Object.entries(accountLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Full name">
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Juan Dela Cruz"
                    className="input"
                  />
                </Field>
                {accountType === "ojt" && (
                  <Field label="Student ID">
                    <input
                      required
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      placeholder="2024-00001"
                      className="input"
                    />
                  </Field>
                )}
                <Field label={accountType === "ojt" ? "Host company" : "Office / Department"}>
                  <input
                    required
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Philippine Statistics Authority"
                    className="input"
                  />
                </Field>
                <Field label="Position / Role">
                  <input
                    required
                    value={ojtTitle}
                    onChange={(e) => setOjtTitle(e.target.value)}
                    placeholder="(Administrative Officer IV, Intern, Etc..)"
                    className="input"
                  />
                </Field>
                {accountType === "processing" && (
                  <Field label="Required workdays">
                    <input
                      className="input"
                      type="number"
                      required
                      min="1"
                      max="2147483647"
                      step="1"
                      value={requiredDays}
                      onChange={(e) => setRequiredDays(e.target.value)}
                      placeholder="e.g. 90"
                    />
                  </Field>
                )}
              </>
            )}
            <Field label="Email">
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="input"
              />
            </Field>
            {mode !== "forgot" && (
              <Field label="Password">
                <input
                  type="password"
                  required
                  minLength={mode === "signup" ? 8 : undefined}
                  autoComplete={mode === "signin" ? "current-password" : "new-password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input"
                />
              </Field>
            )}

            {msg && (
              <div
                className={`rounded-md px-3 py-2 text-sm ${
                  msg.kind === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                }`}
                role={msg.kind === "error" ? "alert" : "status"}
                aria-live="polite"
              >
                {msg.text}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || (mode === "forgot" && recoveryWait > 0)}
              className="w-full rounded-md bg-blue-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-900 disabled:opacity-60"
            >
              {loading
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : mode === "forgot"
                    ? "Send reset link"
                    : "Create account"}
            </button>

            {mode === "forgot" && recoveryWait > 0 && (
              <p className="text-sm text-slate-600">
                Please wait {recoveryWait} seconds before requesting another reset link. Requests
                are limited to help prevent email abuse.
              </p>
            )}
            <div className="text-center text-sm text-slate-500">
              {mode === "signin" ? (
                <>
                  No account?{" "}
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setMode("signup")}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    Sign up
                  </button>
                  <div className="mt-2">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => {
                        setMode("forgot");
                        setMsg(null);
                      }}
                      className="font-medium text-slate-900 hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                </>
              ) : (
                <>
                  Already have one?{" "}
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => {
                      setMode("signin");
                      setMsg(null);
                    }}
                    className="font-medium text-slate-900 hover:underline"
                  >
                    Sign in
                  </button>
                </>
              )}
            </div>
          </form>
        </div>
      </div>

      <style>{`
        .input {
          width: 100%;
          border-radius: 6px;
          border: 1px solid rgb(226 232 240);
          background: white;
          padding: 0.5rem 0.75rem;
          font-size: 0.875rem;
          color: rgb(15 23 42);
          outline: none;
        }
        .input:focus { border-color: rgb(30 58 138); outline: 2px solid rgb(30 58 138); outline-offset: 2px; }
      `}</style>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </label>
  );
}
