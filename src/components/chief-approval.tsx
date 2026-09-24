import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { prepareChiefAction, approveChiefAction } from "@/lib/chief-approval.functions";
import type { ChiefRequest, ChiefResponse, PunchValues } from "@/lib/chief-input";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";

const inputClass = "mt-1 w-full rounded border p-2";
const buttonClass = "rounded border px-3 py-2 text-sm disabled:opacity-50";
const fields = ["check_in", "break_out", "break_in", "check_out"] as const;
const labels = {
  check_in: "Check In",
  break_out: "Break Out",
  break_in: "Break In",
  check_out: "Check Out",
};
export type EditableDtr = PunchValues & { id?: string; entry_date: string };

export function ChiefApproval({
  request,
  onClose,
  onComplete,
}: {
  request: ChiefRequest;
  onClose: () => void;
  onComplete: (result: ChiefResponse) => void;
}) {
  const prepare = useServerFn(prepareChiefAction);
  const approve = useServerFn(approveChiefAction);
  const [prepared, setPrepared] = useState<ChiefResponse | null>(null);
  const [credential, setCredential] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const settings = request.operation === "change_ssp" || request.operation === "recover_ssp";
  const clear = () => {
    setCredential("");
    setNewPassword("");
    setConfirmPassword("");
    setShow(false);
  };
  useEffect(() => {
    let active = true;
    prepare({ data: request })
      .then((result) => {
        if (!active) return;
        if (result.error) setError(result.error);
        else setPrepared(result);
      })
      .catch(() => {
        if (active) setError("Approval request could not be prepared. Close and try again.");
      });
    return () => {
      active = false;
    };
  }, [prepare, request]);
  const close = () => {
    if (lock.current) return;
    clear();
    onClose();
  };
  const submit = async () => {
    if (lock.current || !prepared || !credential) return;
    if (settings && (newPassword.length < 12 || newPassword !== confirmPassword)) {
      clear();
      setError("New passwords must match and contain at least 12 characters.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const data = {
      requestId: request.requestId,
      credential,
      ...(settings ? { newPassword, confirmPassword } : {}),
    };
    clear();
    try {
      const result = await approve({ data });
      if (result.error) setError(result.error);
      else onComplete(result);
    } catch {
      setError(
        "The response was not confirmed. Reload records before retrying; the action may have completed.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <AlertDialogContent
        className="max-h-[90vh] overflow-y-auto"
        data-chief-prepare-endpoint={prepareChiefAction.url}
        data-chief-approve-endpoint={approveChiefAction.url}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Approval Needed</AlertDialogTitle>
          <AlertDialogDescription>
            {request.operation === "recover_ssp"
              ? "Ask the Chief or authorized custodian to enter the recovery code. The current password cannot be displayed."
              : "This action requires approval from the Chief. Please ask the Chief to enter the Chief Approval Password."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {prepared?.account && (
          <dl className="text-sm">
            <dt>Employee</dt>
            <dd>{prepared.account.name}</dd>
            <dt>Email</dt>
            <dd>{prepared.account.email}</dd>
            <dt>Account type</dt>
            <dd>{prepared.account.account_type}</dd>
            <dt>Position</dt>
            <dd>{prepared.account.position || "Not provided"}</dd>
          </dl>
        )}
        {request.operation === "delete_account" && (
          <p className="text-sm text-red-700">
            Permanent deletion cannot be undone. Accounts with historical records must be
            deactivated instead.
          </p>
        )}
        <label>
          {request.operation === "recover_ssp" ? "Recovery code" : "Chief Approval Password"}
          <input
            className={inputClass}
            type={show ? "text" : "password"}
            value={credential}
            onChange={(e) => setCredential(e.target.value)}
            autoComplete="off"
            maxLength={72}
            disabled={busy}
          />
        </label>
        <button
          type="button"
          className={buttonClass}
          aria-pressed={show}
          onClick={() => setShow(!show)}
          disabled={busy}
        >
          {show ? "Hide password" : "Show password"}
        </button>
        {settings && (
          <>
            <label>
              New Chief Approval Password
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                maxLength={72}
                disabled={busy}
              />
            </label>
            <label>
              Confirm New Password
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                maxLength={72}
                disabled={busy}
              />
            </label>
          </>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {error}
          </p>
        )}
        {!prepared && !error && <p role="status">Checking approval request…</p>}
        <div className="flex gap-2">
          <button className={buttonClass} onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            className={buttonClass}
            onClick={submit}
            disabled={busy || !prepared || !credential || (settings && !newPassword)}
          >
            {busy
              ? "Saving…"
              : request.operation === "delete_account"
                ? "Approve and Delete"
                : "Approve and Save"}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function localTime(stamp: string | null) {
  if (!stamp) return "";
  return new Date(Date.parse(stamp) + 8 * 3600000).toISOString().slice(11, 19);
}
export function DtrEditor({
  userId,
  rows,
  initial,
  onClose,
  onSaved,
}: {
  userId: string;
  rows: EditableDtr[];
  initial?: EditableDtr;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(initial?.entry_date || "");
  const original = rows.find((row) => row.entry_date === date);
  const [values, setValues] = useState<Record<keyof PunchValues, string>>(
    () =>
      Object.fromEntries(fields.map((f) => [f, localTime(initial?.[f] ?? null)])) as Record<
        keyof PunchValues,
        string
      >,
  );
  const [reason, setReason] = useState("");
  const [request, setRequest] = useState<ChiefRequest | null>(null);
  const [error, setError] = useState("");
  const selectDate = (value: string) => {
    setDate(value);
    const row = rows.find((r) => r.entry_date === value);
    setValues(
      Object.fromEntries(fields.map((f) => [f, localTime(row?.[f] ?? null)])) as typeof values,
    );
  };
  const save = () => {
    if (!date || reason.trim().length < 3) {
      setError("Select a date and enter a correction reason of at least 3 characters.");
      return;
    }
    const stamps = Object.fromEntries(
      fields.map((f) => [
        f,
        values[f] === localTime(original?.[f] ?? null)
          ? (original?.[f] ?? null)
          : values[f]
            ? new Date(`${date}T${values[f]}+08:00`).toISOString()
            : null,
      ]),
    ) as PunchValues;
    setRequest({
      requestId: crypto.randomUUID(),
      operation: "edit_dtr",
      payload: {
        targetUserId: userId,
        date,
        reason: reason.trim(),
        expected: original?.id
          ? {
              id: original.id,
              ...(Object.fromEntries(fields.map((f) => [f, original[f]])) as PunchValues),
            }
          : null,
        values: stamps,
      },
    });
  };
  if (request)
    return (
      <ChiefApproval
        request={request}
        onClose={() => setRequest(null)}
        onComplete={() => {
          onSaved();
          onClose();
        }}
      />
    );
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <AlertDialogContent className="max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>Edit DTR</AlertDialogTitle>
          <AlertDialogDescription>
            Review the original and corrected punches in Philippine time. Changes require a reason
            and Chief approval. Clearing punches preserves the record and its audit history.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <label>
          Attendance date
          <input
            type="date"
            className={inputClass}
            value={date}
            onChange={(e) => selectDate(e.target.value)}
          />
        </label>
        {fields.map((f) => (
          <label key={f}>
            {labels[f]}
            <span className="block text-xs">
              Original: {localTime(original?.[f] ?? null) || "Not recorded"}
            </span>
            <input
              type="time"
              aria-label={labels[f]}
              step="1"
              className={inputClass}
              value={values[f]}
              onChange={(e) => setValues((v) => ({ ...v, [f]: e.target.value }))}
            />
          </label>
        ))}
        <label>
          Correction reason
          <textarea
            aria-label="Correction reason"
            className={inputClass}
            value={reason}
            maxLength={1000}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className="flex gap-2">
          <button className={buttonClass} onClick={onClose}>
            Cancel
          </button>
          <button
            className={buttonClass}
            onClick={save}
            disabled={!date || reason.trim().length < 3}
          >
            Save Changes
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ChiefSettings() {
  const [request, setRequest] = useState<ChiefRequest | null>(null);
  const [message, setMessage] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  return (
    <section className="rounded border p-4">
      <h3>Chief Approval Password</h3>
      <p className="text-sm">
        The Chief enters the current password to change it. Recovery requires the separate custodian
        code.
      </p>
      <div className="mt-2 flex gap-2">
        {(
          [
            ["change_ssp", "Change Password"],
            ["recover_ssp", "Forgot Approval Password"],
          ] as const
        ).map(([operation, label]) => (
          <button
            className={buttonClass}
            key={operation}
            onClick={() => {
              setRecoveryCode("");
              setMessage("");
              setRequest({ requestId: crypto.randomUUID(), operation, payload: {} });
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {message && <p role="status">{message}</p>}
      {recoveryCode && (
        <div role="status">
          <p>Store this new recovery code securely. It is shown only once:</p>
          <code>{recoveryCode}</code>
          <button className={buttonClass} onClick={() => setRecoveryCode("")}>
            I have stored the code
          </button>
        </div>
      )}
      {request && (
        <ChiefApproval
          request={request}
          onClose={() => setRequest(null)}
          onComplete={(result) => {
            setRequest(null);
            setMessage("Chief Approval Password updated. The previous password no longer works.");
            setRecoveryCode(result.recoveryCode || "");
          }}
        />
      )}
    </section>
  );
}
