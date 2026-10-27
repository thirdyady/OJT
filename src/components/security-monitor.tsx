import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ShieldCheck, RefreshCw, ChevronLeft, ChevronRight, LogOut, KeyRound } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { accountLabels } from "@/lib/account-progress.mjs";
import type { Database } from "@/integrations/supabase/types";

type Log = Database["public"]["Functions"]["dtr_security_logs"]["Returns"][number];
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const time = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("en-PH", {
        timeZone: "Asia/Manila",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : " - ";
function status(row: Log) {
  if (row.travel_hours != null) return "Travel";
  return row.check_out
    ? "Checked out"
    : row.break_out && !row.break_in
      ? "On break"
      : row.check_in
        ? "Checked in"
        : "Incomplete";
}
export function SecurityMonitor() {
  const navigate = useNavigate();
  const [date, setDate] = useState(today);
  const [currentDay, setCurrentDay] = useState(today);
  const [rows, setRows] = useState<Log[]>([]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("all");
  const [state, setState] = useState("all");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let busy = false;
    async function load() {
      if (busy) return;
      busy = true;
      setLoading(true);
      try {
        const all: Log[] = [];
        let after: string | undefined;
        for (;;) {
          const result = await supabase.rpc("dtr_security_logs", {
            log_date: date,
            after_id: after,
          });
          if (result.error) throw result.error;
          if (cancelled) return;
          if (!result.data.length) break;
          all.push(...result.data);
          const next = result.data.at(-1)!.id;
          if (next === after) throw new Error("Attendance loading did not advance.");
          after = next;
        }
        if (!cancelled) {
          setRows(all.sort((a, b) => (a.full_name ?? "").localeCompare(b.full_name ?? "")));
          setUpdated(new Date().toISOString());
          setError("");
        }
      } catch {
        if (!cancelled) {
          setRows([]);
          setUpdated(null);
          setError(
            "Attendance could not be loaded. Check your connection or ask the administrator to verify your access, then retry.",
          );
        }
      } finally {
        busy = false;
        if (!cancelled) setLoading(false);
      }
    }
    setRows([]);
    setUpdated(null);
    void load();
    // Refresh permission checks for historical views too; inactive access stops displaying data.
    const timer = window.setInterval(() => {
      const next = today();
      setCurrentDay(next);
      if (date === currentDay && next !== currentDay) setDate(next);
      else void load();
    }, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [date, refresh, currentDay]);
  const visible = rows.filter(
    (row) =>
      (type === "all" || row.account_type === type) &&
      (state === "all" || status(row) === state) &&
      (row.full_name ?? "").toLowerCase().includes(search.trim().toLowerCase()),
  );
  const step = (days: number) => {
    const value = new Date(`${date}T12:00:00+08:00`);
    value.setUTCDate(value.getUTCDate() + days);
    setDate(value.toISOString().slice(0, 10));
  };
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8">
          <div className="flex items-center gap-3">
            <ShieldCheck
              className="h-10 w-10 rounded-xl bg-blue-950 p-2 text-white"
              aria-hidden="true"
            />
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-blue-800">
                PSA - Security monitor
              </p>
              <h1 className="text-xl font-bold">Attendance log</h1>
            </div>
          </div>
          <nav className="flex flex-wrap gap-3 text-sm" aria-label="Account">
            <Link
              to="/reset-password"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600"
            >
              <KeyRound size={16} />
              Change password
            </Link>
            <button
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 hover:bg-slate-50"
              onClick={async () => {
                const result = await supabase.auth.signOut();
                if (result.error) setError("Could not sign out. Please try again.");
                else void navigate({ to: "/auth" });
              }}
            >
              <LogOut size={16} />
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-8">
        <div>
          <h2 className="text-2xl font-semibold">A clear view of the day</h2>
          <p className="mt-2 text-sm text-slate-600">
            Recorded attendance only. Verify physical arrivals and departures against your paper
            logbook.
          </p>
        </div>
        <section
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
          aria-label="Attendance filters"
        >
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-sm font-medium">
                Attendance date - Philippine time
                <input
                  aria-label="Attendance date"
                  type="date"
                  value={date}
                  max={currentDay}
                  className="mt-2 block rounded-lg border border-slate-300 px-3 py-2"
                  onChange={(e) => {
                    if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value) && e.target.value <= today())
                      setDate(e.target.value);
                  }}
                />
              </label>
              <button
                aria-label="Previous day"
                className="rounded-lg border p-2"
                onClick={() => step(-1)}
              >
                <ChevronLeft />
              </button>
              <button
                aria-label="Next day"
                disabled={date >= currentDay}
                className="rounded-lg border p-2 disabled:opacity-40"
                onClick={() => step(1)}
              >
                <ChevronRight />
              </button>
              <button
                className="rounded-lg border px-3 py-2 text-sm"
                onClick={() => setDate(today())}
              >
                Today
              </button>
            </div>
            <button
              disabled={loading}
              onClick={() => setRefresh((v) => v + 1)}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <label className="text-sm font-medium">
              Search name
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"
                placeholder="Find a person..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="min-w-0 text-sm font-medium">
              Account type
              <select
                className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"
                aria-label="Account type"
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="all">All account types</option>
                {Object.entries(accountLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Recorded attendance status
              <select
                className="mt-1 w-full rounded-lg border px-3 py-2 font-normal"
                aria-label="Recorded attendance status"
                value={state}
                onChange={(e) => setState(e.target.value)}
              >
                {["all", "Checked in", "On break", "Checked out", "Travel", "Incomplete"].map(
                  (value) => (
                    <option key={value} value={value}>
                      {value === "all" ? "All statuses" : value}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>
        </section>
        {error && (
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
          >
            {error}
          </div>
        )}
        <section
          aria-label="Recorded attendance"
          aria-busy={loading}
          className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          <div className="flex flex-wrap justify-between gap-2 border-b px-5 py-4">
            <h2 className="font-semibold">
              {visible.length} attendance {visible.length === 1 ? "record" : "records"}
            </h2>
            <p role="status" className="text-xs text-slate-500">
              {loading
                ? "Updating attendance..."
                : updated
                  ? `Updated ${time(updated)}  -  Refreshes every 30 seconds`
                  : "No successful update yet"}
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Attendance for {date}, times in Asia/Manila</caption>
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  {[
                    "Name / Account type",
                    "Check in",
                    "Break out",
                    "Break in",
                    "Check out",
                    "Recorded status",
                  ].map((label) => (
                    <th scope="col" key={label} className="whitespace-nowrap px-5 py-4">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((row) => (
                  <tr key={row.id} className="hover:bg-blue-50/40">
                    <th scope="row" className="px-5 py-4 font-medium">
                      <span className="block">{row.full_name || "Name unavailable"}</span>
                      <span className="mt-1 block text-xs font-normal text-slate-500">
                        {accountLabels[row.account_type]}
                      </span>
                    </th>
                    {[row.check_in, row.break_out, row.break_in, row.check_out].map((value, i) => (
                      <td key={i} className="whitespace-nowrap px-5 py-4 tabular-nums">
                        {time(value)}
                      </td>
                    ))}
                    <td className="px-5 py-4">
                      <span
                        className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium ${row.check_out ? "bg-slate-100 text-slate-700" : row.break_out && !row.break_in ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-800"}`}
                      >
                        {status(row)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!visible.length && !loading && !error && (
            <p className="px-5 py-12 text-center text-sm text-slate-500">
              {rows.length
                ? "No records match your filters."
                : "No attendance recorded for this date."}
            </p>
          )}
        </section>
        <p className="text-xs text-slate-500">
          Read-only access - For password resets, contact the system administrator. No email inbox
          is required.
        </p>
      </div>
    </main>
  );
}
