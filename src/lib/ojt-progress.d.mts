export type AttendanceRecord = {
  check_in: string | null;
  break_out: string | null;
  break_in: string | null;
  check_out: string | null;
};

export type OjtProgress = {
  requiredHours: number;
  completedHours: number;
  remainingHours: number;
  completionPercentage: number;
  isComplete: boolean;
  overageHours: number;
};

export function calculateCompletedHours(record: AttendanceRecord): number;
export function calculateCompletedHoursFromRecords(records: AttendanceRecord[]): number;
export function calculateOjtProgress(requiredHours: number | null, completedHours: number): OjtProgress;
