const HOUR_IN_MS = 3_600_000;

/**
 * Return hours only for a complete, chronologically valid DTR record.
 * A lone break timestamp is treated as incomplete because its duration cannot
 * be calculated safely.
 */
export function calculateCompletedHours(record) {
  if (!record?.check_in || !record?.check_out) return 0;

  const checkIn = Date.parse(record.check_in);
  const checkOut = Date.parse(record.check_out);
  if (!Number.isFinite(checkIn) || !Number.isFinite(checkOut) || checkOut <= checkIn) return 0;

  const hasBreakOut = Boolean(record.break_out);
  const hasBreakIn = Boolean(record.break_in);
  if (hasBreakOut !== hasBreakIn) return 0;

  let breakMs = 0;
  if (hasBreakOut && hasBreakIn) {
    const breakOut = Date.parse(record.break_out);
    const breakIn = Date.parse(record.break_in);
    if (
      !Number.isFinite(breakOut) ||
      !Number.isFinite(breakIn) ||
      breakOut < checkIn ||
      breakIn <= breakOut ||
      breakIn > checkOut
    ) {
      return 0;
    }
    breakMs = breakIn - breakOut;
  }

  return Math.max(0, checkOut - checkIn - breakMs) / HOUR_IN_MS;
}

export function calculateCompletedHoursFromRecords(records) {
  return (records ?? []).reduce((total, record) => total + calculateCompletedHours(record), 0);
}

export function calculateOjtProgress(requiredHours, completedHours) {
  const required = Number.isFinite(Number(requiredHours)) ? Math.max(0, Number(requiredHours)) : 0;
  const completed = Number.isFinite(Number(completedHours))
    ? Math.max(0, Number(completedHours))
    : 0;
  const remaining = Math.max(0, required - completed);
  const completionPercentage = required > 0 ? (completed / required) * 100 : 0;

  return {
    requiredHours: required,
    completedHours: completed,
    remainingHours: remaining,
    completionPercentage,
    isComplete: required > 0 && completed >= required,
    overageHours: Math.max(0, completed - required),
  };
}
