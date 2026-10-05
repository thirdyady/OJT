import { accountLabels, completedWorkdays } from "./account-progress.mjs";
import { calculateCompletedHours, calculateCompletedHoursFromRecords } from "./ojt-progress.mjs";

export function validDateRange(from, to) {
  const valid = (value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  return valid(from) && valid(to) && from <= to;
}
export function reportAccounts(profiles, type = "all", status = "all") {
  return profiles.filter(
    (p) =>
      !p.is_admin &&
      (type === "all" || p.account_type === type) &&
      (status === "all" || p.is_active === (status === "active")),
  );
}
export function buildAttendanceReport(profiles, records, from, to, type = "all", status = "all") {
  if (!validDateRange(from, to))
    throw new Error("Select a valid date range with the start on or before the end.");
  const grouped = new Map();
  for (const row of records) {
    if (row.entry_date < from || row.entry_date > to) continue;
    if (!grouped.has(row.user_id)) grouped.set(row.user_id, []);
    grouped.get(row.user_id).push(row);
  }
  return reportAccounts(profiles, type, status).map((profile) => {
    const rows = (grouped.get(profile.id) || [])
      .slice()
      .sort((a, b) => a.entry_date.localeCompare(b.entry_date));
    const required =
      profile.account_type === "ojt"
        ? profile.required_ojt_hours
        : profile.account_type === "processing"
          ? profile.required_workdays
          : null;
    return {
      profile,
      rows,
      hours: calculateCompletedHoursFromRecords(rows),
      days: completedWorkdays(rows),
      required,
      unit:
        profile.account_type === "ojt"
          ? "hours"
          : profile.account_type === "processing"
            ? "days"
            : null,
    };
  });
}
export function reportCsvCell(value) {
  let text = String(value ?? "");
  if (/^\s*[=+\-@]|^[\t\r\n]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
const csv = (rows) => rows.map((row) => row.map(reportCsvCell).join(",")).join("\r\n");
export function summaryReportCsv(report, from, to) {
  const hoursTarget = report.some((r) => r.profile.account_type === "ojt");
  const daysTarget = report.some((r) => r.profile.account_type === "processing");
  return csv([
    [
      "Name",
      "Account type",
      "Status",
      "Position",
      "From",
      "To",
      "Credited hours",
      "Completed valid workdays",
      ...(hoursTarget ? ["Required hours"] : []),
      ...(daysTarget ? ["Required days"] : []),
    ],
    ...report.map((r) => [
      r.profile.full_name || "Not provided",
      accountLabels[r.profile.account_type],
      r.profile.is_active ? "Active" : "Inactive",
      r.profile.ojt_title || "Not provided",
      from,
      to,
      r.hours.toFixed(2),
      r.days,
      ...(hoursTarget ? [r.unit === "hours" ? (r.required ?? "Not configured") : ""] : []),
      ...(daysTarget ? [r.unit === "days" ? (r.required ?? "Not configured") : ""] : []),
    ]),
  ]);
}
const clock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Manila",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});
export function detailReportCsv(report) {
  const time = (value) =>
    value && Number.isFinite(Date.parse(value)) ? clock.format(new Date(value)) : "";
  return csv([
    [
      "Name",
      "Account type",
      "Status",
      "Date (Philippines)",
      "Check In",
      "Break Out",
      "Break In",
      "Check Out",
      "Credited hours",
    ],
    ...report.flatMap((r) =>
      r.rows.map((row) => [
        r.profile.full_name || "Not provided",
        accountLabels[r.profile.account_type],
        r.profile.is_active ? "Active" : "Inactive",
        row.entry_date,
        time(row.check_in),
        time(row.break_out),
        time(row.break_in),
        time(row.check_out),
        calculateCompletedHours(row).toFixed(2),
      ]),
    ),
  ]);
}
export function roleReportText(profile, records) {
  const hours = calculateCompletedHoursFromRecords(records).toFixed(2);
  if (profile.account_type === "ojt")
    return `Credited hours (selected period): ${hours} hrs | Required hours: ${profile.required_ojt_hours ?? "Not configured"}`;
  if (profile.account_type === "processing")
    return `Completed valid workdays (selected period): ${completedWorkdays(records)} | Required days: ${profile.required_workdays ?? "Not configured"}`;
  return "";
}
