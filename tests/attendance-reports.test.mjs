import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildAttendanceReport,
  validDateRange,
  summaryReportCsv,
  detailReportCsv,
  roleReportText,
} from "../src/lib/attendance-reports.mjs";
const profiles = ["ojt", "job_order", "processing", "regular_employee"].map((account_type, i) => ({
  id: String(i),
  full_name: `Person ${i}`,
  account_type,
  is_admin: false,
  is_active: i !== 2,
  required_ojt_hours: account_type === "ojt" ? 400 : null,
  required_workdays: account_type === "processing" ? 20 : null,
}));
const rows = profiles.map((p) => ({
  user_id: p.id,
  entry_date: "2026-09-01",
  check_in: "2026-09-01T00:00:00Z",
  break_out: "2026-09-01T04:00:00Z",
  break_in: "2026-09-01T05:00:00Z",
  check_out: "2026-09-01T09:00:00Z",
}));
test("reports filter account type, status and inclusive dates without including admins or other users", () => {
  const report = buildAttendanceReport(
    [...profiles, { ...profiles[0], id: "admin", is_admin: true }],
    [...rows, { ...rows[0], user_id: "unknown" }, { ...rows[0], entry_date: "2026-08-31" }],
    "2026-09-01",
    "2026-09-01",
  );
  assert.equal(report.length, 4);
  assert.deepEqual(
    report.map((r) => r.hours),
    [8, 8, 8, 8],
  );
  assert.deepEqual(
    report.map((r) => r.unit),
    ["hours", null, "days", null],
  );
  assert.equal(
    buildAttendanceReport(profiles, rows, "2026-09-01", "2026-09-30", "processing", "inactive")
      .length,
    1,
  );
  assert.equal(
    buildAttendanceReport(profiles, rows, "2026-09-01", "2026-09-30", "processing", "active")
      .length,
    0,
  );
});
test("invalid dates, missing attendance and incomplete or duplicate workdays", () => {
  for (const dates of [
    ["2026-02-30", "2026-03-01"],
    ["", "2026-01-01"],
    ["2026-09-02", "2026-09-01"],
  ])
    assert.equal(validDateRange(...dates), false);
  const report = buildAttendanceReport(
    profiles,
    [rows[0], rows[0], { ...rows[2], break_in: null }],
    "2026-09-01",
    "2026-09-30",
  );
  assert.equal(report[0].days, 1);
  assert.equal(report[2].days, 0);
  assert.equal(report[2].hours, 0);
  assert.equal(report[1].rows.length, 0);
  assert.throws(() => buildAttendanceReport(profiles, rows, "bad", "bad"));
});
test("CSV and monthly text expose only relevant targets and preserve Manila details", () => {
  const all = buildAttendanceReport(profiles, rows, "2026-09-01", "2026-09-30");
  assert.match(summaryReportCsv(all, "2026-09-01", "2026-09-30"), /Required hours.*Required days/);
  for (const type of ["job_order", "regular_employee"]) {
    const subset = all.filter((r) => r.profile.account_type === type);
    assert.doesNotMatch(
      summaryReportCsv(subset, "2026-09-01", "2026-09-30"),
      /Required|progress|percentage/i,
    );
    assert.equal(roleReportText(subset[0].profile, subset[0].rows), "");
  }
  assert.match(roleReportText(profiles[0], rows.slice(0, 1)), /8.00 hrs.*400/);
  assert.match(roleReportText(profiles[2], rows.slice(2, 3)), /1.*20/);
  assert.match(detailReportCsv(all), /08:00:00.*12:00:00.*13:00:00.*17:00:00.*8.00/);
  all[0].profile = { ...all[0].profile, full_name: '=HYPERLINK("bad")' };
  assert.match(summaryReportCsv(all, "2026-09-01", "2026-09-30"), /"'=HYPERLINK/);
});
