import { test } from "node:test";
import assert from "node:assert/strict";
import { attendanceDate } from "../src/lib/dtr-time.ts";

test("Manila attendance dates are stable across device zones and midnight/month/year boundaries", () => {
  const previous = process.env.TZ;
  try {
    for (const zone of ["Asia/Manila", "UTC", "America/Los_Angeles", "Pacific/Kiritimati"]) {
      process.env.TZ = zone;
      for (const [instant, expected] of [
        ["2026-09-20T15:59:59Z", "2026-09-20"],
        ["2026-09-20T16:00:00Z", "2026-09-21"],
        ["2026-09-30T16:00:00Z", "2026-10-01"],
        ["2026-12-31T16:00:00Z", "2027-01-01"],
        ["2028-02-28T16:00:00Z", "2028-02-29"],
      ])
        assert.equal(attendanceDate(new Date(instant)), expected, `${zone}: ${instant}`);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});
