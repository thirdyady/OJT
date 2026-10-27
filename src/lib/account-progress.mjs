import { calculateCompletedHours, calculateCompletedHoursFromRecords } from "./ojt-progress.mjs";

export const accountLabels = {
  ojt: "OJT/Immersions",
  job_order: "JO/COS/GIP",
  processing: "Field Enumerator / Office processor",
  regular_employee: "Regular / Contractual Employees",
};

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Manila",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
function manilaDay(value) {
  const parts = dayFormat.formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type).value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function completedWorkdays(records) {
  const days = new Set();
  for (const row of records ?? []) {
    if (calculateCompletedHours(row) <= 0 || !row.entry_date) continue;
    if (row.travel_hours != null) {
      days.add(row.entry_date);
      continue;
    }
    if (manilaDay(row.check_in) !== row.entry_date || manilaDay(row.check_out) !== row.entry_date)
      continue;
    days.add(row.entry_date);
  }
  return days.size;
}

// The latest started period remains visible after its end until the next starts.
export function currentProcessingContract(contracts, date = manilaDay(new Date())) {
  return (
    (contracts ?? [])
      .filter((c) => c.start_date <= date)
      .sort((a, b) => b.start_date.localeCompare(a.start_date))[0] ?? null
  );
}

// Call with one account's RLS-filtered history, never a mixed account list.
export function accountProgress(profile, records) {
  const hours = calculateCompletedHoursFromRecords(records);
  const contract =
    profile.account_type === "processing" && profile.processing_contracts
      ? currentProcessingContract(profile.processing_contracts)
      : null;
  const scoped =
    profile.account_type === "processing" && profile.processing_contracts
      ? contract
        ? records.filter(
            (r) =>
              r.entry_date >= contract.start_date &&
              (!contract.end_date || r.entry_date <= contract.end_date),
          )
        : []
      : records;
  const days = completedWorkdays(scoped);
  const unit =
    profile.account_type === "ojt"
      ? "hours"
      : profile.account_type === "processing"
        ? "days"
        : null;
  const value =
    unit === "hours"
      ? profile.required_ojt_hours
      : unit === "days"
        ? profile.processing_contracts
          ? contract?.required_workdays
          : profile.required_workdays
        : null;
  const target = Number.isFinite(value) && value > 0 ? value : null;
  const credited = unit === "days" ? days : unit === "hours" ? hours : null;
  return {
    hours,
    days,
    unit,
    target,
    credited,
    percentage: unit && target !== null ? (credited / target) * 100 : null,
    remaining: unit && target !== null ? Math.max(0, target - credited) : null,
  };
}
