import type { AttendanceRecord } from "./ojt-progress.mjs";
import type { Enums } from "../integrations/supabase/types";
export const accountLabels: Record<Enums<"account_type">, string>;
export type ProgressProfile = {
  account_type: Enums<"account_type">;
  required_ojt_hours: number | null;
  required_workdays: number | null;
};
export type DatedAttendance = AttendanceRecord & { entry_date: string };
export function completedWorkdays(records: DatedAttendance[]): number;
export function accountProgress(
  profile: ProgressProfile,
  records: DatedAttendance[],
): {
  hours: number;
  days: number;
  unit: "hours" | "days" | null;
  target: number | null;
  credited: number | null;
  percentage: number | null;
  remaining: number | null;
};
