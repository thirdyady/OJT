import type { Tables, Enums } from "../integrations/supabase/types";
import type { DatedAttendance } from "./account-progress.mjs";
export type ReportProfile = Pick<
  Tables<"profiles">,
  | "id"
  | "full_name"
  | "ojt_title"
  | "account_type"
  | "is_active"
  | "is_admin"
  | "required_ojt_hours"
  | "required_workdays"
>;
export type ReportRow = DatedAttendance & { user_id: string; id?: string };
export type ReportType = Enums<"account_type"> | "all";
export type ReportStatus = "all" | "active" | "inactive";
export type AccountReport = {
  profile: ReportProfile;
  rows: ReportRow[];
  hours: number;
  days: number;
  required: number | null;
  unit: "hours" | "days" | null;
};
export function validDateRange(from: string, to: string): boolean;
export function reportAccounts(
  profiles: ReportProfile[],
  type?: ReportType,
  status?: ReportStatus,
): ReportProfile[];
export function buildAttendanceReport(
  profiles: ReportProfile[],
  records: ReportRow[],
  from: string,
  to: string,
  type?: ReportType,
  status?: ReportStatus,
): AccountReport[];
export function reportCsvCell(value: unknown): string;
export function summaryReportCsv(report: AccountReport[], from: string, to: string): string;
export function detailReportCsv(report: AccountReport[]): string;
export function roleReportText(
  profile: Pick<ReportProfile, "account_type" | "required_ojt_hours" | "required_workdays">,
  records: DatedAttendance[],
): string;
