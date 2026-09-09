import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateCompletedHours,
  calculateCompletedHoursFromRecords,
  calculateOjtProgress,
} from "../src/lib/ojt-progress.mjs";

const at = (day, time) => `${day}T${time}:00+08:00`;

test("calculates a normal complete day", () => {
  assert.equal(
    calculateCompletedHours({
      check_in: at("2026-09-01", "08:00"),
      break_out: null,
      break_in: null,
      check_out: at("2026-09-01", "17:00"),
    }),
    9,
  );
});

test("does not count an incomplete day", () => {
  assert.equal(
    calculateCompletedHours({
      check_in: at("2026-09-01", "08:00"),
      break_out: at("2026-09-01", "12:00"),
      break_in: at("2026-09-01", "13:00"),
      check_out: null,
    }),
    0,
  );
  assert.equal(
    calculateCompletedHours({
      check_in: at("2026-09-01", "08:00"),
      break_out: at("2026-09-01", "12:00"),
      break_in: null,
      check_out: at("2026-09-01", "17:00"),
    }),
    0,
  );
});

test("sums complete records across multiple months", () => {
  assert.equal(
    calculateCompletedHoursFromRecords([
      {
        check_in: at("2026-01-15", "08:00"),
        break_out: null,
        break_in: null,
        check_out: at("2026-01-15", "16:00"),
      },
      {
        check_in: at("2026-02-15", "09:00"),
        break_out: null,
        break_in: null,
        check_out: at("2026-02-15", "17:00"),
      },
      {
        check_in: at("2026-02-16", "08:00"),
        break_out: null,
        break_in: null,
        check_out: null,
      },
    ]),
    16,
  );
});

test("subtracts a completed break from a full day", () => {
  assert.equal(
    calculateCompletedHours({
      check_in: at("2026-09-01", "08:00"),
      break_out: at("2026-09-01", "12:00"),
      break_in: at("2026-09-01", "13:00"),
      check_out: at("2026-09-01", "17:00"),
    }),
    8,
  );
});

test("reports progress exactly at 100 percent", () => {
  assert.deepEqual(calculateOjtProgress(486, 486), {
    requiredHours: 486,
    completedHours: 486,
    remainingHours: 0,
    completionPercentage: 100,
    isComplete: true,
    overageHours: 0,
  });
});

test("keeps over-target completion visible while remaining hours stay at zero", () => {
  assert.deepEqual(calculateOjtProgress(486, 500), {
    requiredHours: 486,
    completedHours: 500,
    remainingHours: 0,
    completionPercentage: (500 / 486) * 100,
    isComplete: true,
    overageHours: 14,
  });
});
