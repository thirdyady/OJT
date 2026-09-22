import { useRef, useState, type FormEvent } from "react";
import { useServerFn } from "@tanstack/react-start";
import { createTraineeAccount, type CreatedTraineeProfile } from "@/lib/admin-account.functions";
import { accountInput, type AccountInput } from "@/lib/account-input";

const empty = {
  fullName: "",
  studentId: "",
  company: "",
  ojtTitle: "",
  email: "",
  password: "",
  confirm: "",
  hours: "",
  days: "",
};

export function CreateAccountForm({
  disabled,
  onCreated,
  onBusyChange,
}: {
  disabled: boolean;
  onCreated: (profile: CreatedTraineeProfile) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const create = useServerFn(createTraineeAccount);
  const [accountType, setAccountType] = useState<AccountInput["accountType"]>("ojt");
  const [fields, setFields] = useState(empty);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const lock = useRef(false);
  const isOjt = accountType === "ojt";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || disabled) return;
    setError("");
    setSuccess("");
    const parsed = accountInput.safeParse({
      accountType,
      email: fields.email,
      password: fields.password,
      fullName: fields.fullName,
      company: fields.company,
      ojtTitle: fields.ojtTitle,
      studentId: isOjt ? fields.studentId : null,
      requiredOjtHours: isOjt && fields.hours.trim() ? Number(fields.hours) : null,
      requiredWorkdays:
        accountType === "processing" && fields.days.trim() ? Number(fields.days) : null,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0].message);
      return;
    }
    if (fields.password !== fields.confirm) {
      setError("Temporary passwords do not match.");
      return;
    }
    // All local validation precedes the request and Auth ID allocation.
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    try {
      const { profile } = await create({ data: parsed.data });
      onCreated(profile);
      setFields(empty);
      setSuccess(`Account created for ${profile.full_name || parsed.data.email}.`);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Account creation was not confirmed. Please try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  const field = (
    key: keyof typeof empty,
    label: string,
    options: {
      type?: string;
      required?: boolean;
      aria?: string;
      maxLength?: number;
      min?: number;
      max?: number;
      step?: string;
    } = {},
  ) => (
    <label className="block" key={key}>
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <input
        type={options.type || "text"}
        required={options.required !== false}
        aria-label={options.aria || label}
        maxLength={options.maxLength}
        min={options.min}
        max={options.max}
        step={options.step}
        autoComplete={options.type === "password" ? "new-password" : undefined}
        value={fields[key]}
        onChange={(e) => {
          setFields((current) => ({ ...current, [key]: e.target.value }));
          setError("");
          setSuccess("");
        }}
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
      />
    </label>
  );

  return (
    <form
      onSubmit={submit}
      noValidate
      data-admin-create-account-endpoint={createTraineeAccount.url}
      aria-busy={busy}
      className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
    >
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">Create account</h3>
        <p className="mt-1 text-xs text-slate-500">
          Set sign-in details and profile. The account is active immediately after successful
          creation.
        </p>
      </div>
      <fieldset disabled={busy || disabled} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Account type</span>
          <select
            aria-label="New account type"
            value={accountType}
            onChange={(e) => {
              setAccountType(e.target.value as AccountInput["accountType"]);
              setFields((current) => ({ ...current, studentId: "", hours: "", days: "" }));
              setError("");
              setSuccess("");
            }}
            className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="ojt">OJT</option>
            <option value="job_order">JO</option>
            <option value="processing">Processing</option>
            <option value="regular_employee">Regular Employee</option>
          </select>
        </label>
        {field("fullName", "Full Name", { aria: "New trainee full name", maxLength: 200 })}
        {isOjt &&
          field("studentId", "Student ID", { aria: "New trainee student ID", maxLength: 100 })}
        {field("company", isOjt ? "Host Company" : "Office / Department", {
          aria: isOjt ? "New trainee host company" : "New account office",
          maxLength: 200,
        })}
        {field("ojtTitle", isOjt ? "OJT Title" : "Position", {
          aria: isOjt ? "New trainee OJT title" : "New account position",
          maxLength: 200,
        })}
        {field("email", "Email", { type: "email", aria: "New trainee email", maxLength: 254 })}
        {field("password", "Temporary password", {
          type: "password",
          aria: "New trainee temporary password",
          maxLength: 72,
        })}
        {field("confirm", "Confirm password", {
          type: "password",
          aria: "Confirm new trainee password",
          maxLength: 72,
        })}
        {isOjt &&
          field("hours", "Required OJT hours (optional)", {
            type: "number",
            required: false,
            aria: "New trainee required OJT hours",
            min: 0.01,
            max: 10000,
            step: "any",
          })}
        {accountType === "processing" &&
          field("days", "Required workdays", {
            type: "number",
            min: 1,
            max: 2147483647,
            step: "1",
          })}
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={busy || disabled}
          className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {busy ? "Creating..." : "Create account"}
        </button>
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
        {success && (
          <p role="status" className="text-xs text-emerald-700">
            {success}
          </p>
        )}
      </div>
    </form>
  );
}
