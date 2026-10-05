import { useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  Download,
  FileSpreadsheet,
  LoaderCircle,
  SlidersHorizontal,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { loadProfiles, loadReportDtrRows } from "@/lib/dtr-data";
import { attendanceDate } from "@/lib/dtr-time";
import { accountLabels } from "@/lib/account-progress.mjs";
import {
  buildAttendanceReport,
  validDateRange,
  summaryReportCsv,
  detailReportCsv,
  type AccountReport,
  type ReportProfile,
  type ReportType,
  type ReportStatus,
} from "@/lib/attendance-reports.mjs";
const control =
  "min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-900 shadow-sm transition-colors hover:border-slate-400 focus-visible:border-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
const button =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(date + "T00:00:00Z"));
export function AdminReports({
  profiles,
  profilesLoading,
  profilesError,
}: {
  profiles: ReportProfile[];
  profilesLoading: boolean;
  profilesError: string | null;
}) {
  const [type, setType] = useState<ReportType>("all");
  const [status, setStatus] = useState<ReportStatus>("all");
  const [from, setFrom] = useState(() => attendanceDate().slice(0, 8) + "01");
  const [to, setTo] = useState(attendanceDate);
  const [result, setResult] = useState<{ key: string; report: AccountReport[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const version = useRef(0);
  const lock = useRef(false);
  const key = JSON.stringify([profiles, type, status, from, to, profilesLoading, profilesError]);
  const currentKey = useRef(key);
  currentKey.current = key;
  useEffect(() => {
    version.current++;
    setError("");
  }, [key]);
  useEffect(
    () => () => {
      version.current++;
    },
    [],
  );
  const report = result?.key === key ? result.report : null;
  const authorize = async () => {
    const role = await supabase.rpc("dtr_is_admin");
    if (role.error || !role.data)
      throw new Error(
        "Active administrator access could not be verified. Sign in again before generating or exporting reports.",
      );
  };
  const generate = async () => {
    if (lock.current || profilesLoading || profilesError) return;
    if (!validDateRange(from, to)) {
      setResult(null);
      setError("Select a valid date range with the start on or before the end.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    setResult(null);
    const request = ++version.current;
    try {
      await authorize();
      const [rows, reportProfiles] = await Promise.all([
        loadReportDtrRows(from, to),
        loadProfiles(),
      ]);
      await authorize();
      if (version.current !== request || currentKey.current !== key) return;
      setResult({
        key,
        report: buildAttendanceReport(reportProfiles, rows, from, to, type, status),
      });
    } catch (e) {
      if (version.current === request) {
        setResult(null);
        setError(e instanceof Error ? e.message : "Report could not be loaded. Try again.");
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const download = async (details: boolean) => {
    if (!report || !report.length || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await authorize();
      if (currentKey.current !== key) return;
      const text = details ? detailReportCsv(report) : summaryReportCsv(report, from, to);
      const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `PSA-${details ? "details" : "summary"}-${type}-${status}-${from}-to-${to}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setResult(null);
      setError("Report export could not be authorized. Sign in again and regenerate the report.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <section
      aria-labelledby="admin-report-title"
      className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <header className="flex items-start gap-3 border-b border-slate-200 px-4 py-5 sm:gap-4 sm:px-6 sm:py-6">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-950 text-white">
          <FileSpreadsheet className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h2
            id="admin-report-title"
            className="text-lg font-semibold tracking-tight text-slate-950 sm:text-xl"
          >
            Attendance reports
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Review attendance by account type and period, then export your results.
          </p>
        </div>
      </header>
      <div className="border-b border-slate-200 bg-slate-50/80 px-4 py-5 sm:px-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <SlidersHorizontal className="size-4 text-slate-500" aria-hidden="true" />
            Report filters
          </h3>
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <CalendarDays className="size-3.5" aria-hidden="true" />
            Philippine dates · inclusive range
          </span>
        </div>
        <fieldset
          disabled={busy || profilesLoading || Boolean(profilesError)}
          className="grid min-w-0 gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <legend className="sr-only">Report filters</legend>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-600">
            Account type
            <select
              aria-label="Report account type"
              className={control}
              value={type}
              onChange={(e) => setType(e.target.value as ReportType)}
            >
              <option value="all">All account types</option>
              {Object.entries(accountLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-600">
            Account status
            <select
              aria-label="Report account status"
              className={control}
              value={status}
              onChange={(e) => setStatus(e.target.value as ReportStatus)}
            >
              <option value="all">Active and inactive</option>
              <option value="active">Active accounts</option>
              <option value="inactive">Inactive accounts</option>
            </select>
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-600">
            Start date
            <input
              aria-label="Report start date"
              className={control}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="grid min-w-0 gap-1.5 text-xs font-medium text-slate-600">
            End date
            <input
              aria-label="Report end date"
              className={control}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </fieldset>
        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            className={button + " bg-blue-950 text-white shadow-sm hover:bg-blue-900"}
            onClick={generate}
            disabled={busy || profilesLoading || Boolean(profilesError)}
          >
            {busy ? (
              <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            ) : (
              <FileSpreadsheet className="size-4" aria-hidden="true" />
            )}
            {busy ? "Working…" : "Generate report"}
          </button>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <button
              className={
                button + " border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }
              aria-label="Export report summary (Summary CSV)"
              disabled={busy || !report?.length}
              onClick={() => download(false)}
            >
              <Download className="size-4 shrink-0" aria-hidden="true" />
              Summary CSV
            </button>
            <button
              className={
                button + " border border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
              }
              aria-label="Export attendance details (Details CSV)"
              disabled={busy || !report?.some((r) => r.rows.length)}
              onClick={() => download(true)}
            >
              <Download className="size-4 shrink-0" aria-hidden="true" />
              Details CSV
            </button>
          </div>
        </div>
      </div>
      <div className="px-4 py-5 sm:px-6 sm:py-6" aria-busy={busy || profilesLoading}>
        {profilesLoading && (
          <p role="status" className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            Loading accounts for reports…
          </p>
        )}
        {profilesError && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            Accounts could not be loaded. Reload the page before generating reports.
          </p>
        )}
        {busy && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-lg bg-blue-50 p-4 text-sm text-blue-900"
          >
            <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden="true" />
            Preparing the selected report…
          </p>
        )}
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {!busy && !error && !profilesError && !profilesLoading && !report && (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center">
            <FileSpreadsheet className="mb-3 size-7 text-slate-400" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-slate-800">Your report starts here</h3>
            <p className="mt-1 max-w-sm text-sm leading-relaxed text-slate-500">
              Choose your filters, then select Generate report to review attendance for the period.
            </p>
          </div>
        )}
        {report && (
          <div className={busy ? "mt-4" : ""} aria-live="polite">
            <dl className="mb-6 grid grid-cols-2 overflow-hidden rounded-xl border border-slate-200 bg-slate-50/60 sm:grid-cols-[1fr_1fr_1.5fr]">
              <div className="border-r border-slate-200 p-4 sm:p-5">
                <dt className="text-xs font-medium text-slate-500">Accounts in report</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-slate-950">
                  {report.length}
                </dd>
              </div>
              <div className="p-4 sm:border-r sm:border-slate-200 sm:p-5">
                <dt className="text-xs font-medium text-slate-500">Credited hours</dt>
                <dd className="mt-1 text-2xl font-semibold tabular-nums tracking-tight text-blue-950">
                  {report.reduce((n, r) => n + r.hours, 0).toFixed(2)}
                </dd>
              </div>
              <div className="col-span-2 border-t border-slate-200 p-4 sm:col-span-1 sm:border-t-0 sm:p-5">
                <dt className="text-xs font-medium text-slate-500">Reporting period</dt>
                <dd className="mt-2 text-sm font-semibold text-slate-800">
                  {dateLabel(from)} <span className="mx-1 font-normal text-slate-400">—</span>{" "}
                  {dateLabel(to)}
                </dd>
              </div>
            </dl>
            {!report.length ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center">
                <p className="text-sm font-semibold text-slate-800">
                  No accounts match these filters.
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  Try another account type or status and generate again.
                </p>
              </div>
            ) : (
              <div
                className="max-h-[32rem] overflow-auto rounded-xl border border-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
                role="region"
                aria-label="Report results"
                tabIndex={0}
              >
                <table className="w-full min-w-[740px] border-separate border-spacing-0 text-left text-sm">
                  <caption className="sr-only">
                    Filtered attendance totals for the selected date range
                  </caption>
                  <thead className="sticky top-0 z-10 bg-slate-100">
                    <tr>
                      {[
                        "Name",
                        "Account type",
                        "Status",
                        "Credited hours",
                        "Completed valid workdays",
                        ...(report.some((r) => r.unit) ? ["Applicable requirement"] : []),
                      ].map((h) => (
                        <th
                          key={h}
                          scope="col"
                          className={
                            "whitespace-nowrap border-b border-slate-200 px-4 py-3 text-xs font-semibold text-slate-600 " +
                            (h === "Credited hours" || h === "Completed valid workdays"
                              ? "text-right"
                              : "")
                          }
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.map((r) => (
                      <tr
                        key={r.profile.id}
                        className="group even:bg-slate-50/60 hover:bg-blue-50/50"
                      >
                        <th
                          scope="row"
                          className="min-w-[220px] max-w-64 border-b border-slate-100 px-4 py-4 font-medium text-slate-900 [overflow-wrap:anywhere] group-last:border-b-0"
                        >
                          {r.profile.full_name || "Name not provided"}
                          {r.profile.ojt_title && (
                            <span className="mt-0.5 block text-xs font-normal text-slate-500">
                              {r.profile.ojt_title}
                            </span>
                          )}
                          {!r.rows.length && (
                            <span className="mt-1 block text-xs font-normal text-slate-500">
                              No attendance in this period
                            </span>
                          )}
                        </th>
                        <td className="whitespace-nowrap border-b border-slate-100 px-4 py-4 text-slate-600 group-last:border-b-0">
                          {accountLabels[r.profile.account_type]}
                        </td>
                        <td className="border-b border-slate-100 px-4 py-4 group-last:border-b-0">
                          <span
                            className={
                              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium " +
                              (r.profile.is_active
                                ? "bg-emerald-50 text-emerald-800"
                                : "bg-slate-100 text-slate-600")
                            }
                          >
                            <span
                              className={
                                "size-1.5 rounded-full " +
                                (r.profile.is_active ? "bg-emerald-600" : "bg-slate-400")
                              }
                              aria-hidden="true"
                            />
                            {r.profile.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="border-b border-slate-100 px-4 py-4 text-right font-medium tabular-nums text-slate-900 group-last:border-b-0">
                          {r.hours.toFixed(2)}
                        </td>
                        <td className="border-b border-slate-100 px-4 py-4 text-right tabular-nums text-slate-700 group-last:border-b-0">
                          {r.days}
                        </td>
                        {report.some((r) => r.unit) && (
                          <td className="whitespace-nowrap border-b border-slate-100 px-4 py-4 tabular-nums text-slate-600 group-last:border-b-0">
                            {r.unit
                              ? r.required === null
                                ? "Not configured"
                                : r.required + " " + r.unit
                              : "—"}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-4 text-xs leading-relaxed text-slate-500">
              Totals reflect the selected period. Requirements are overall targets for OJT and
              Processing; JO and Regular Employee have no progress target. Generate again to include
              recent changes.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
