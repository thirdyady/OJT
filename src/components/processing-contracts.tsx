import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  completedWorkdays,
  type ProcessingContract,
  type DatedAttendance,
} from "@/lib/account-progress.mjs";
import { attendanceDate } from "@/lib/dtr-time";
import type { Tables } from "@/integrations/supabase/types";

const control =
  "mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:outline-blue-700";
export function ProcessingContracts({
  contracts,
  records,
  userId,
  onSaved,
}: {
  contracts: ProcessingContract[];
  records: DatedAttendance[];
  userId?: string;
  onSaved?: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<ProcessingContract | "new" | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [days, setDays] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [audit, setAudit] = useState<Tables<"processing_contract_audit">[] | null>(null);
  const lock = useRef(false);
  const request = useRef("");
  const snapshot = useRef<ProcessingContract | null>(null);
  const sorted = [...contracts].sort((a, b) => b.start_date.localeCompare(a.start_date));
  const open = (item: ProcessingContract | "new") => {
    snapshot.current = item === "new" ? sorted[0] : item;
    setEditing(item);
    setError("");
    setMessage("");
    setReason("");
    request.current = crypto.randomUUID();
    setStart(item === "new" ? attendanceDate() : item.start_date);
    setEnd(item === "new" ? "" : (item.end_date ?? ""));
    setDays(item === "new" ? "" : String(item.required_workdays));
  };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current || !userId || !editing) return;
    if (
      !/^\d+$/.test(days) ||
      Number(days) < 1 ||
      !reason.trim() ||
      !start ||
      (end && end < start)
    ) {
      setError("Enter valid dates, positive whole workdays and a reason.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await supabase.rpc("dtr_save_processing_contract", {
        target_user_id: userId,
        contract_id: editing === "new" ? null : editing.id,
        expected_revision: snapshot.current!.revision,
        expected_latest_id: snapshot.current!.id,
        starts: start,
        ends: end || null,
        days: Number(days),
        correction_reason: reason.trim(),
        operation_id: request.current,
      });
      if (result.error) throw new Error(result.error.message);
      setEditing(null);
      setAudit(null);
      setMessage("Contract saved. Attendance history is unchanged.");
      try {
        await onSaved?.();
      } catch {
        setError(
          "Saved, but the refreshed contracts could not be loaded. Reload the page before making another change.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Contract was not saved. Try again.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function loadAudit() {
    if (!userId || lock.current) return;
    const result = await supabase
      .from("processing_contract_audit")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (result.error) setError("Could not load contract change history. Try again.");
    else setAudit(result.data);
  }
  return (
    <section
      aria-label="Processing contracts"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-slate-900">Contract periods</h2>
          <p className="mt-1 text-sm text-slate-600">
            One account, separate goals. Your attendance history stays intact.
          </p>
        </div>
        {userId && (
          <button
            type="button"
            className="min-h-11 rounded-lg bg-blue-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={busy || !sorted.length}
            onClick={() => open("new")}
          >
            Renew contract
          </button>
        )}
      </div>
      {!sorted.length && (
        <p className="mt-3 text-sm" role="status">
          No contract configured. Contact an administrator.
        </p>
      )}
      <ul className="mt-4 divide-y divide-slate-100">
        {sorted.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="text-sm font-medium">
                {c.start_date === "0001-01-01" ? "Existing history" : c.start_date} ?{" "}
                {c.end_date ?? "Until renewal"}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {completedWorkdays(
                  records.filter(
                    (r) =>
                      r.entry_date >= c.start_date && (!c.end_date || r.entry_date <= c.end_date),
                  ),
                )}{" "}
                / {c.required_workdays} completed workdays
                {c.start_date > attendanceDate() ? " ? Upcoming" : ""}
              </p>
            </div>
            {userId && (
              <button
                type="button"
                disabled={busy}
                className="min-h-11 rounded-lg border border-slate-300 px-3 text-sm font-medium disabled:opacity-50"
                onClick={() => open(c)}
              >
                Edit contract
              </button>
            )}
          </li>
        ))}
      </ul>
      {editing && (
        <form onSubmit={save} className="mt-4 space-y-4 rounded-xl bg-slate-50 p-4">
          <h3 className="font-semibold">
            {editing === "new" ? "New contract period" : "Edit contract period"}
          </h3>
          <p className="text-sm text-slate-600">
            Progress uses valid workdays within these dates, including both endpoints. Periods
            cannot overlap. Renewing an open-ended period closes it the day before the new start.
            Attendance is never reset.
          </p>
          <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm">
              Start date
              <input
                aria-label="Contract start date"
                className={control}
                type="date"
                required
                value={start}
                onChange={(e) => {
                  setStart(e.target.value);
                  request.current = crypto.randomUUID();
                }}
              />
            </label>
            <label className="text-sm">
              End date
              <input
                aria-label="Contract end date"
                className={control}
                type="date"
                required={editing === "new" || editing.end_date !== null}
                value={end}
                onChange={(e) => {
                  setEnd(e.target.value);
                  request.current = crypto.randomUUID();
                }}
              />
            </label>
            <label className="text-sm">
              Required workdays
              <input
                className={control}
                type="number"
                min="1"
                step="1"
                required
                value={days}
                onChange={(e) => {
                  setDays(e.target.value);
                  request.current = crypto.randomUUID();
                }}
              />
            </label>
            <label className="text-sm sm:col-span-3">
              Reason for contract change
              <textarea
                className={control}
                maxLength={1000}
                required
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  request.current = crypto.randomUUID();
                }}
              />
            </label>
          </fieldset>
          <div className="flex flex-wrap gap-3">
            <button
              disabled={busy}
              className="min-h-11 rounded-lg bg-blue-900 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving?" : "Save contract"}
            </button>
            <button
              type="button"
              disabled={busy}
              className="min-h-11 rounded-lg border border-slate-300 px-4 text-sm"
              onClick={() => setEditing(null)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {message && (
        <p role="status" className="mt-3 text-sm text-emerald-800">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {userId && (
        <details
          className="mt-4 text-sm"
          onToggle={(e) => {
            if (e.currentTarget.open && audit === null) void loadAudit();
          }}
        >
          <summary className="cursor-pointer py-2 font-medium">Contract change history</summary>
          <button type="button" className="underline" onClick={() => void loadAudit()}>
            Refresh history
          </button>
          <p className="text-xs text-slate-500">
            Latest 100 changes. Times are shown in your browser timezone.
          </p>
          {audit?.length === 0 && <p>No administrator changes yet.</p>}
          {audit?.map((a) => (
            <div key={a.id} className="mt-3 rounded-lg border p-3">
              <p>
                {new Date(a.created_at).toLocaleString()} ? {a.reason}
              </p>
              <p className="break-all text-xs text-slate-500">Administrator: {a.actor_id}</p>
              <details>
                <summary className="cursor-pointer">Original and updated periods</summary>
                <pre className="overflow-auto text-xs">
                  {JSON.stringify({ before: a.old_values, after: a.new_values }, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
