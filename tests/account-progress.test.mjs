import { test } from "node:test";
import assert from "node:assert/strict";
import { accountProgress, completedWorkdays } from "../src/lib/account-progress.mjs";

const day = (date = "2026-09-01", overrides = {}) => ({
  entry_date: date,
  check_in: `${date}T08:00:00+08:00`,
  check_out: `${date}T17:00:00+08:00`,
  break_out: `${date}T12:00:00+08:00`,
  break_in: `${date}T13:00:00+08:00`,
  ...overrides,
});
const records = [day(), day("2026-09-02")];
test("OJT uses credited hours without changing the existing calculation", () => {
  const p = accountProgress({ account_type: "ojt", required_ojt_hours: 32 }, records);
  assert.equal(p.credited, 16);
  assert.equal(p.percentage, 50);
  assert.equal(p.remaining, 16);
});
test("Processing counts valid days, never overtime as multiple days", () => {
  const p = accountProgress({ account_type: "processing", required_workdays: 4 }, records);
  assert.equal(p.credited, 2);
  assert.equal(p.percentage, 50);
  assert.equal(p.unit, "days");
});
for (const type of ["job_order", "regular_employee"])
  test(`${type} never exposes a target or percentage, even with stale target values`, () => {
    const p = accountProgress(
      { account_type: type, required_workdays: 4, required_ojt_hours: 32 },
      records,
    );
    assert.equal(p.unit, null);
    assert.equal(p.target, null);
    assert.equal(p.percentage, null);
    assert.equal(p.hours, 16);
    assert.equal(p.days, 2);
  });
test("missing targets retain credited totals without a fabricated completion percentage", () => {
  for (const type of ["ojt", "processing"]) {
    const p = accountProgress({ account_type: type }, records);
    assert.equal(p.target, null);
    assert.equal(p.percentage, null);
    assert.equal(p.credited, type === "ojt" ? 16 : 2);
  }
});
test("workdays exclude incomplete/invalid/zero-net/cross-date records and deduplicate dates", () => {
  assert.equal(
    completedWorkdays([
      day(),
      day(),
      day("2026-09-02", { check_out: null }),
      day("2026-09-03", { break_in: null }),
      day("2026-09-04", { check_out: "2026-09-04T07:00:00+08:00" }),
      day("2026-09-05", {
        break_out: "2026-09-05T08:00:00+08:00",
        break_in: "2026-09-05T17:00:00+08:00",
      }),
      day("2026-09-06", { check_in: "invalid" }),
      day("2026-09-07", { check_out: "2026-09-08T01:00:00+08:00" }),
      day("2026-09-08", { break_out: null, break_in: null }),
    ]),
    2,
  );
});
test("workday matching uses Manila dates and handles month/year boundaries", () => {
  assert.equal(
    completedWorkdays([
      day("2027-01-01", {
        check_in: "2026-12-31T23:00:00Z",
        check_out: "2027-01-01T01:00:00Z",
        break_out: null,
        break_in: null,
      }),
    ]),
    1,
  );
});
test("over-target progress remains visible without negative remaining credit", () => {
  const p = accountProgress({ account_type: "processing", required_workdays: 1 }, records);
  assert.equal(p.percentage, 200);
  assert.equal(p.remaining, 0);
});
