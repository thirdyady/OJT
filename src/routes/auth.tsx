import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getEmailConfirmationRedirectUrl, getPasswordRecoveryRedirectUrl } from "@/lib/auth-urls";
import psaImage from "../../assets/psa.jpg";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Sign in · OJT DTR" },
      {
        name: "description",
        content: "Create an account or sign in to track your OJT DTR.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [company, setCompany] = useState("");
  const [ojtTitle, setOjtTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<{ kind: "error" | "info"; text: string } | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard" });
    });
  }, [navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMsg(null);
    try {
      if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: getPasswordRecoveryRedirectUrl(),
        });
        if (error) throw error;
        setMsg({
          kind: "info",
          text: "If an account exists for this email, a password reset link has been sent. Check your inbox.",
        });
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: getEmailConfirmationRedirectUrl(),
            data: {
              full_name: fullName.trim(),
              student_id: studentId.trim(),
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
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen bg-slate-50">
      {/* Left: PSA image panel (hidden on small screens) */}
      <div className="relative hidden w-1/2 items-center justify-center bg-slate-900 lg:flex">
        <img src={psaImage} alt="PSA" className="h-full w-full object-cover" />
      </div>

      {/* Right: Sign in / Sign up form */}
      <div className="flex w-full items-center justify-center px-4 py-12 lg:w-1/2">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <Link to="/" className="text-xs font-medium uppercase tracking-widest text-slate-500">
              OJT DTR
            </Link>
            <h1 className="mt-2 text-2xl font-semibold text-slate-900">
              {mode === "forgot"
                ? "Reset your password"
                : mode === "signin"
                  ? "Sign in to your DTR"
                  : "Create your trainee account"}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {mode === "forgot"
                ? "Enter your registered email to request a reset link."
                : mode === "signin"
                  ? "Track your daily time record securely."
                  : "Start logging your OJT attendance in seconds."}
            </p>
          </div>

          <form
            onSubmit={submit}
            className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            {mode === "signup" && (
              <>
                <Field label="Full name">
                  <input
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Juan Dela Cruz"
                    className="input"
                  />
                </Field>
                <Field label="Student ID">
                  <input
                    required
                    value={studentId}
                    onChange={(e) => setStudentId(e.target.value)}
                    placeholder="2024-00001"
                    className="input"
                  />
                </Field>
                <Field label="Host company">
                  <input
                    required
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Acme Corp."
                    className="input"
                  />
                </Field>
                <Field label="OJT title">
                  <input
                    required
                    value={ojtTitle}
                    onChange={(e) => setOjtTitle(e.target.value)}
                    placeholder="Data Analyst Intern"
                    className="input"
                  />
                </Field>
              </>
            )}
            <Field label="Email">
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@school.edu"
                className="input"
              />
            </Field>
            {mode !== "forgot" && (
              <Field label="Password">
                <input
                  type="password"
                  required
                  minLength={6}
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
              disabled={loading}
              className="w-full rounded-md bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {loading
                ? "Please wait…"
                : mode === "signin"
                  ? "Sign in"
                  : mode === "forgot"
                    ? "Send reset link"
                    : "Create account"}
            </button>

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
        .input:focus { border-color: rgb(100 116 139); }
      `}</style>
    </div>
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
