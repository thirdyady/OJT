import { test } from "node:test";
import assert from "node:assert/strict";
import { accountProgress, currentProcessingContract } from "../src/lib/account-progress.mjs";
import { buildAttendanceReport, roleReportText } from "../src/lib/attendance-reports.mjs";
const periods = [
  { id: "a", start_date: "2000-01-01", end_date: "2000-01-31", required_workdays: 20, revision: 1 },
  { id: "b", start_date: "2000-02-01", end_date: "2000-04-30", required_workdays: 80, revision: 1 },
  { id: "c", start_date: "2999-01-01", end_date: "2999-12-31", required_workdays: 50, revision: 1 },
];
const profile = {
  id: "p",
  account_type: "processing",
  required_workdays: 20,
  processing_contracts: periods,
  is_active: true,
};
const complete = (date) => ({
  user_id: "p",
  entry_date: date,
  check_in: date + "T08:00:00+08:00",
  check_out: date + "T16:00:00+08:00",
});
test("renewal counts only valid unique dates within inclusive contract boundaries", () => {
  const rows = ["2000-01-31", "2000-02-01", "2000-04-30", "2000-05-01"].map(complete);
  rows.push(complete("2000-02-01"), { ...complete("2000-02-02"), check_out: null });
  const progress = accountProgress(profile, rows);
  assert.equal(progress.target, 80);
  assert.equal(progress.credited, 2);
  assert.equal(progress.percentage, 2.5);
  assert.equal(currentProcessingContract(periods, "2000-01-31").id, "a");
  assert.equal(currentProcessingContract(periods, "2000-02-01").id, "b");
  assert.equal(currentProcessingContract(periods, "2999-01-01").id, "c");
});
test("no started contract means no invented progress or fallback to the legacy target", () => {
  const result = accountProgress({ ...profile, processing_contracts: [periods[2]] }, [
    complete("2000-01-01"),
  ]);
  assert.equal(result.target, null);
  assert.equal(result.credited, 0);
  assert.equal(result.percentage, null);
});
test("reports use the selected historical contract, and never invent a combined target", () => {
  const rows = [complete("2000-01-10"), complete("2000-02-10")];
  assert.equal(buildAttendanceReport([profile], rows, "2000-01-01", "2000-01-31")[0].required, 20);
  assert.equal(buildAttendanceReport([profile], rows, "2000-02-01", "2000-02-29")[0].required, 80);
  const combined = buildAttendanceReport([profile], rows, "2000-01-01", "2000-02-29")[0];
  assert.equal(combined.required, null);
  assert.equal(combined.days, 2);
  assert.match(roleReportText(profile, rows, "2000-01-01", "2000-02-29"), /multiple/);
});
test("OJT calculations ignore Processing contract data and remain lifetime hours", () => {
  const progress = accountProgress({ ...profile, account_type: "ojt", required_ojt_hours: 16 }, [
    complete("1999-01-01"),
  ]);
  assert.equal(progress.credited, 8);
  assert.equal(progress.percentage, 50);
});
