import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AttendanceRecord } from "@/lib/ojt-progress.mjs";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
const input = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm";
export function TravelDetails({
  row,
}: {
  row: Pick<AttendanceRecord, "travel_hours" | "travel_place" | "travel_reason">;
}) {
  if (row.travel_hours == null) return null;
  return (
    <div className="my-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-left text-xs font-normal text-blue-950">
      <strong>Travel - {row.travel_hours} hours</strong>
      <div className="mt-1 break-words">Place: {row.travel_place}</div>
      <div className="mt-1 whitespace-pre-wrap break-words">Reason: {row.travel_reason}</div>
    </div>
  );
}
export function TravelOut({
  date,
  disabled,
  onBusy,
  onSaved,
}: {
  date: string;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [selectedDate, setSelectedDate] = useState(date);
  const [hours, setHours] = useState("8"),
    [place, setPlace] = useState(""),
    [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const lock = useRef(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (lock.current || disabled) return;
    if (
      !place.trim() ||
      place.trim().length > 15 ||
      !reason.trim() ||
      reason.trim().length > 1000
    ) {
      setError("Enter a place (up to 15 characters) and a reason (up to 1000 characters).");
      return;
    }
    lock.current = true;
    setBusy(true);
    onBusy(true);
    setError("");
    let saved = false;
    try {
      const result = await supabase.rpc("dtr_travel_out", {
        expected_date: selectedDate,
        hours: Number(hours),
        place: place.trim(),
        reason: reason.trim(),
      });
      if (result.error) throw new Error(result.error.message);
      saved = true;
      setOpen(false);
      setMessage(
        `Travel recorded: ${hours} hours credited. Normal punches are unavailable for this date.`,
      );
      await onSaved();
    } catch (err) {
      if (saved) setMessage("Travel was saved. Reload the page to display the latest attendance.");
      else {
        setError(
          err instanceof Error
            ? err.message
            : "Could not confirm travel. Refresh attendance before retrying.",
        );
        try {
          await onSaved();
        } catch {
          /* Keep form values and the save error. */
        }
      }
    } finally {
      lock.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div className="mt-4 border-t border-slate-100 pt-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          className="min-h-11 rounded-lg border border-blue-900 px-5 py-3 text-sm font-semibold text-blue-950 hover:bg-blue-50 disabled:opacity-40"
          disabled={disabled || busy}
          onClick={() => {
            setSelectedDate(date);
            setError("");
            setOpen(true);
          }}
        >
          Travel Out
        </button>
        <p className="text-xs text-slate-500">
          Use this when your workday is spent on official business or work-related travel. Available
          before recording any attendance today.
        </p>
      </div>
      {message && (
        <p role="status" className="mt-3 text-sm text-blue-900">
          {message}
        </p>
      )}
      <AlertDialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) setOpen(value);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Travel Out</AlertDialogTitle>
            <AlertDialogDescription>
              Record travel for {selectedDate} (Philippine date). Your selected hours are credited
              immediately instead of normal punches. Corrections require an administrator and Chief
              approval.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <form onSubmit={save} className="space-y-4">
            <label className="block text-sm">
              Credited hours
              <select
                aria-label="Credited hours"
                className={input}
                value={hours}
                disabled={busy}
                onChange={(e) => setHours(e.target.value)}
              >
                <option value="8">8 hours</option>
                <option value="10">10 hours</option>
              </select>
            </label>
            <label className="block text-sm">
              Place of travel
              <input
                className={input}
                required
                maxLength={15}
                placeholder="e.g. Bukidnon, Mis. Occ."
                value={place}
                disabled={busy}
                onChange={(e) => setPlace(e.target.value)}
              />
            </label>
            <label className="block text-sm">
              Reason for travel
              <textarea
                className={input}
                required
                maxLength={1000}
                value={reason}
                disabled={busy}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {error && (
              <p role="alert" className="text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={busy}
                className="rounded-lg border px-4 py-2"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                disabled={busy || disabled}
                className="rounded-lg bg-blue-950 px-4 py-2 text-white disabled:opacity-50"
                type="submit"
              >
                {busy ? "Saving..." : "Confirm Travel Out"}
              </button>
            </div>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
