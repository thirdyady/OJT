import { useState } from "react";
import { CalendarDays, Check, Clock3, CircleAlert, Minus } from "lucide-react";
import { attendanceDate, ATTENDANCE_TIME_ZONE } from "@/lib/dtr-time";
import { calculateCompletedHours } from "@/lib/ojt-progress.mjs";
import type { DatedAttendance } from "@/lib/account-progress.mjs";

type Row = DatedAttendance & { id?: string };
const labels = {
  complete: "Complete",
  incomplete: "Incomplete",
  review: "Needs review",
  empty: "No record",
  upcoming: "Upcoming",
  ongoing: "In progress",
};
type Status = keyof typeof labels;
const styles: Record<Status, string> = {
  complete: "border-emerald-200 bg-emerald-50 text-emerald-900",
  incomplete: "border-amber-200 bg-amber-50 text-amber-900",
  ongoing: "border-blue-200 bg-blue-50 text-blue-900",
  review: "border-rose-200 bg-rose-50 text-rose-900",
  empty: "border-slate-200 bg-white text-slate-500",
  upcoming: "border-slate-100 bg-slate-50 text-slate-500",
};
const icons = {
  complete: Check,
  incomplete: Clock3,
  ongoing: Clock3,
  review: CircleAlert,
  empty: Minus,
  upcoming: Minus,
};
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
const timeLabel = (stamp: string | null) =>
  !stamp
    ? "Not recorded"
    : !Number.isFinite(Date.parse(stamp))
      ? "Invalid time"
      : new Intl.DateTimeFormat("en-PH", {
          timeZone: ATTENDANCE_TIME_ZONE,
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(stamp));

export function AttendanceCalendar({
  records,
  month,
  year,
  today,
  warning,
}: {
  records: Row[];
  month: number;
  year: number;
  today: string;
  warning: (row: Row) => string | null;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
  const grouped = new Map<string, Row[]>();
  for (const row of records)
    grouped.set(row.entry_date, [...(grouped.get(row.entry_date) ?? []), row]);
  const statusFor = (date: string): Status => {
    const rows = grouped.get(date) ?? [];
    if (!rows.length) return date > today ? "upcoming" : "empty";
    if (rows.length !== 1) return "review";
    const row = rows[0];
    const stamps = [row.check_in, row.break_out, row.break_in, row.check_out].filter(
      (stamp): stamp is string => Boolean(stamp),
    );
    if (
      warning(row) ||
      stamps.some(
        (stamp) => !Number.isFinite(Date.parse(stamp)) || attendanceDate(new Date(stamp)) !== date,
      )
    )
      return "review";
    if (row.check_out) return calculateCompletedHours(row) > 0 ? "complete" : "review";
    return date === today && row.check_in ? "ongoing" : "incomplete";
  };
  const days = Array.from(
    { length: new Date(Date.UTC(year, month + 1, 0)).getUTCDate() },
    (_, i) => `${monthKey}-${String(i + 1).padStart(2, "0")}`,
  );
  const offset = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const selectedRows = selected ? (grouped.get(selected) ?? []) : [];
  const row = selectedRows.length === 1 ? selectedRows[0] : null;
  return (
    <section
      aria-label="Attendance calendar"
      className="border-b border-slate-200 bg-slate-50/50 p-3 sm:p-5"
    >
      <div className="mb-4 flex items-start gap-3">
        <CalendarDays aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-blue-800" />
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Attendance this month</h3>
          <p className="mt-1 text-xs text-slate-600">
            Select a date to view its punches. Philippine time. No record does not mean absent.
          </p>
        </div>
      </div>
      <div
        className="mb-2 grid grid-cols-7 text-center text-[11px] font-semibold text-slate-500"
        aria-hidden="true"
      >
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {Array.from({ length: offset }, (_, i) => (
          <span aria-hidden="true" key={`blank-${i}`} />
        ))}
        {days.map((date, i) => {
          const status = statusFor(date),
            Icon = icons[status];
          return (
            <button
              key={date}
              type="button"
              onClick={() => setSelected(date)}
              aria-label={`${dateLabel(date)}: ${labels[status]}${date === today ? ", today" : ""}`}
              aria-pressed={selected === date}
              aria-current={date === today ? "date" : undefined}
              className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-lg border py-2 text-xs transition-colors sm:min-h-20 ${styles[status]} ${selected === date ? "ring-2 ring-blue-700 ring-offset-1" : "hover:brightness-95"} ${date === today ? "font-bold underline decoration-blue-700 decoration-2 underline-offset-4" : "font-medium"}`}
            >
              <span>{i + 1}</span>
              <Icon aria-hidden="true" className="h-3.5 w-3.5" />
              <span className="hidden text-[10px] sm:block">{labels[status]}</span>
            </button>
          );
        })}
      </div>
      <ul
        aria-label="Calendar legend"
        className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-600"
      >
        {(["complete", "ongoing", "incomplete", "review", "empty", "upcoming"] as Status[]).map(
          (status) => {
            const Icon = icons[status];
            return (
              <li key={status} className="flex items-center gap-1">
                <span className={`rounded border p-0.5 ${styles[status]}`}>
                  <Icon aria-hidden="true" className="h-3 w-3" />
                </span>
                {labels[status]}
              </li>
            );
          },
        )}
      </ul>
      <div
        aria-live="polite"
        aria-atomic="true"
        className="mt-4 rounded-xl border border-slate-200 bg-white p-4"
      >
        {!selected ? (
          <p className="text-xs text-slate-500">
            Choose a day above to see its attendance details.
          </p>
        ) : (
          <>
            <h4 className="text-sm font-semibold text-slate-900">
              {dateLabel(selected)} · {labels[statusFor(selected)]}
            </h4>
            {row ? (
              <>
                <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {(
                    [
                      ["Check In", row.check_in],
                      ["Break Out", row.break_out],
                      ["Break In", row.break_in],
                      ["Check Out", row.check_out],
                    ] as const
                  ).map(([label, stamp]) => (
                    <div key={label}>
                      <dt className="text-xs text-slate-500">{label}</dt>
                      <dd className="mt-1 text-sm font-medium tabular-nums text-slate-900">
                        {timeLabel(stamp)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-3 text-xs text-slate-600">
                  Credited hours: {calculateCompletedHours(row).toFixed(2)} hrs
                </p>
                {statusFor(selected) === "review" && (
                  <p className="mt-2 text-xs text-rose-800">
                    This record needs administrator review. See the DTR below for details.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-slate-600">
                {selectedRows.length > 1
                  ? "Multiple records were found for this date. Contact an administrator."
                  : selected > today
                    ? "This date is upcoming. No attendance has been recorded."
                    : "No attendance was recorded for this date. This is not an absence or leave classification."}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
