import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createTraineeAccount, type CreatedTraineeProfile } from "@/lib/admin-account.functions";
import {
  calculateCompletedHours as computeHours,
  calculateCompletedHoursFromRecords,
  calculateOjtProgress,
} from "@/lib/ojt-progress.mjs";
import psaLogo from "../../../assets/psa-logo.webp";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "My DTR · OJT Attendance" },
      {
        name: "description",
        content:
          "Punch in, break out, break in, and check out. Your daily time record is saved to your account.",
      },
    ],
  }),
  component: DashboardPage,
});

type Punch = "check_in" | "break_out" | "break_in" | "check_out";

function punchValue(field: Punch, value: string | null): Partial<Record<Punch, string | null>> {
  return { [field]: value };
}

type DtrRow = {
  id?: string;
  user_id?: string;
  entry_date: string;
  check_in: string | null;
  break_out: string | null;
  break_in: string | null;
  check_out: string | null;
};

type Profile = {
  full_name: string | null;
  student_id: string | null;
  company: string | null;
  ojt_title: string | null;
  required_ojt_hours: number | null;
  is_active: boolean;
  is_admin?: boolean;
};

type TraineeRow = {
  id: string;
  full_name: string | null;
  student_id: string | null;
  company: string | null;
  ojt_title: string | null;
  required_ojt_hours: number | null;
  is_admin: boolean;
  is_active: boolean;
};

const ORDER: Punch[] = ["check_in", "break_out", "break_in", "check_out"];
const LABELS: Record<Punch, string> = {
  check_in: "Check In",
  break_out: "Break Out",
  break_in: "Break In",
  check_out: "Check Out",
};

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function fmtDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function hhmm(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

// Filter a set of DTR rows down to only the ones that fall within the given
// month/year. Used to keep the on-screen table in sync with whatever
// month/year is selected in the dropdowns (instead of always showing every
// row ever logged).
function filterRowsByMonth<T extends DtrRow>(
  rows: T[],
  targetMonth: number,
  targetYear: number,
): T[] {
  return rows.filter((r) => {
    const d = new Date(r.entry_date + "T00:00:00");
    return d.getMonth() === targetMonth && d.getFullYear() === targetYear;
  });
}

const EMPTY_PROFILE: Profile = {
  full_name: "",
  student_id: "",
  company: "",
  ojt_title: "",
  required_ojt_hours: null,
  is_active: true,
  is_admin: false,
};

function missingProfileFields(profile: Profile): string[] {
  const missing: string[] = [];
  if (!profile.full_name?.trim()) missing.push("Full Name");
  if (!profile.student_id?.trim()) missing.push("Student ID");
  if (!profile.company?.trim()) missing.push("Host Company");
  if (!profile.ojt_title?.trim()) missing.push("OJT Title");
  return missing;
}

// ── Shared DTR document builder ─────────────────────────────────────────────
// Pulled out as standalone functions (not tied to component state) so both
// the trainee's own dashboard AND the admin's per-trainee view can generate
// the same printable/downloadable DTR document.
function buildDtrHtmlFor(
  fullName: string,
  rows: DtrRow[],
  targetMonth: number,
  targetYear: number,
) {
  const byDay: Record<number, DtrRow> = {};
  for (const r of rows) {
    const d = new Date(r.entry_date + "T00:00:00");
    if (d.getMonth() === targetMonth && d.getFullYear() === targetYear) {
      byDay[d.getDate()] = r;
    }
  }

  const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const isWeekend = (day: number) => {
    const dow = new Date(targetYear, targetMonth, day).getDay();
    return dow === 0 || dow === 6;
  };

  const rows31: string[] = [];
  for (let day = 1; day <= 31; day++) {
    const row = day <= daysInMonth ? byDay[day] : null;
    const weekend = day <= daysInMonth && isWeekend(day);
    const color = weekend ? "#cc0000" : "#000000";
    const amIn = row ? hhmm(row.check_in) : "";
    const amOut = row ? hhmm(row.break_out) : "";
    const pmIn = row ? hhmm(row.break_in) : "";
    const pmOut = row ? hhmm(row.check_out) : "";
    rows31.push(`
      <tr>
        <td style="color:${color};text-align:center;font-size:8.5px;padding:0 2px;">${day <= daysInMonth ? day : ""}</td>
        <td style="font-size:7.5px;text-align:center;padding:0 1px;">${amIn}</td>
        <td style="font-size:7.5px;text-align:center;padding:0 1px;">${amOut}</td>
        <td style="font-size:7.5px;text-align:center;padding:0 1px;">${pmIn}</td>
        <td style="font-size:7.5px;text-align:center;padding:0 1px;">${pmOut}</td>
      </tr>
    `);
  }

  const monthLabel = `${MONTHS[targetMonth]} ${targetYear}`;

  const copy = `
    <div class="copy">
      <div class="title-wrap"><h1>DAILY TIME RECORD</h1></div>
      <div class="name-block">
        <div class="name-value">${escapeHtml(fullName)}</div>
      </div>
      <div class="month-line">For the month of: &nbsp;<strong>${monthLabel}</strong></div>
      <table>
        <thead>
          <tr>
            <th rowspan="2" style="width:20px;">Day</th>
            <th colspan="2">AM</th>
            <th colspan="2">PM</th>
          </tr>
          <tr>
            <th>Time In</th><th>Time Out</th>
            <th>Time In</th><th>Time Out</th>
          </tr>
        </thead>
        <tbody>${rows31.join("")}</tbody>
      </table>
      <div class="cert">
        I CERTIFY on my honor that above is a true and correct<br/>
        report of the hours of work performed, record of which was made<br/>
        daily at the time of arrival at and departure from office.
      </div>
      <div class="trainee-sig">
        <div class="sig-line"></div>
        <div class="sig-name">${escapeHtml(fullName)}</div>
      </div>
      <div class="verified">Verified as to the prescribed office hours.</div>
      <div class="supervisor-sig">
        <div class="sig-name">JOSE B. TUASON JR.</div>
        <div class="sig-line"></div>
        <div class="sig-title">CHIEF ADMINISTRATIVE OFFICER</div>
      </div>
    </div>
  `;

  const styles = `
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4 portrait; margin: 10mm 8mm; }
    html, body { height: 100%; }
    body { font-family: Arial, sans-serif; font-size: 10px; color: #000; height: 100%; }
    .page { display: flex; flex-direction: row; width: 100%; min-height: 257mm; }
    .copy { width: 50%; padding: 4mm 12mm; border-right: 1px dashed #bbb; display: flex; flex-direction: column; }
    .copy:last-child { border-right: none; }
    .title-wrap { border-top: 2.5px double #000; border-bottom: 2.5px double #000; padding: 3px 0; margin-bottom: 6px; }
    h1 { font-size: 15px; font-weight: 900; text-align: center; letter-spacing: 1.5px; }
    .name-block { text-align: center; margin-bottom: 1px; }
    .name-value { font-size: 12px; font-weight: bold; border-bottom: 1px solid #000; display: inline-block; min-width: 160px; padding: 0 8px; text-align: center; }
    .name-label { font-size: 8px; text-align: center; color: #c00; margin-bottom: 5px; }
    .month-line { font-size: 9px; margin-bottom: 5px; }
    .month-line strong { font-weight: bold; }
    table { width: 100%; border-collapse: collapse; }
    table, th, td { border: 1px solid #000; }
    th { font-size: 8px; text-align: center; padding: 2px 0; font-weight: bold; }
    td { height: 13px; }
    .cert { font-size: 8px; margin-top: 10px; line-height: 1.6; text-align: center; }
    .trainee-sig { margin-top: 10px; text-align: center; }
    .trainee-sig .sig-line { border-top: 1px solid #000; width: 80%; margin: 0 auto 2px; }
    .trainee-sig .sig-name { font-size: 10px; font-weight: bold; }
    .verified { font-size: 7.5px; margin-top: 6px; margin-bottom: 8px; }
    .supervisor-sig { text-align: center; }
    .supervisor-sig .sig-name { font-size: 10px; font-weight: bold; margin-bottom: 1px; }
    .supervisor-sig .sig-line { border-top: 2.5px solid #000; width: 80%; margin: 0 auto 2px; }
    .supervisor-sig .sig-title { font-size: 9px; font-weight: bold; }
    @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
  `;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>DTR – ${monthLabel}</title>
<style>${styles}</style>
</head>
<body>
<div class="page">${copy}${copy}</div>
</body>
</html>`;

  return { html, monthLabel };
}

function printDtrFor(fullName: string, rows: DtrRow[], targetMonth: number, targetYear: number) {
  const { html } = buildDtrHtmlFor(fullName, rows, targetMonth, targetYear);
  const iframe = document.createElement("iframe");
  // Allow printing and parent access, but never scripts in the generated document.
  iframe.setAttribute("sandbox", "allow-same-origin allow-modals");
  iframe.style.cssText = "width:0;height:0;border:none;position:absolute;left:-9999px;top:-9999px;";
  document.body.appendChild(iframe);
  iframe.srcdoc = html;
  iframe.onload = () => {
    iframe.contentWindow?.print();
    setTimeout(() => document.body.removeChild(iframe), 2000);
  };
}

function downloadWordDtrFor(
  fullName: string,
  rows: DtrRow[],
  targetMonth: number,
  targetYear: number,
) {
  const monthLabel = `${MONTHS[targetMonth]} ${targetYear}`;

  const byDay: Record<number, DtrRow> = {};
  for (const r of rows) {
    const d = new Date(r.entry_date + "T00:00:00");
    if (d.getMonth() === targetMonth && d.getFullYear() === targetYear) {
      byDay[d.getDate()] = r;
    }
  }

  const daysInMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
  const isWeekend = (day: number) => {
    const dow = new Date(targetYear, targetMonth, day).getDay();
    return dow === 0 || dow === 6;
  };

  const cell = (txt: string, extra = "") =>
    `<td style="border:1px solid #000;font-size:7.5pt;text-align:center;vertical-align:middle;padding:1px 2px;height:14px;${extra}">${txt}</td>`;

  const hdrCell = (txt: string, extra = "") =>
    `<td style="border:1px solid #000;font-size:7.5pt;font-weight:bold;text-align:center;vertical-align:middle;padding:2px;${extra}">${txt}</td>`;

  let rows31 = "";
  for (let day = 1; day <= 31; day++) {
    const row = day <= daysInMonth ? byDay[day] : null;
    const weekend = day <= daysInMonth && isWeekend(day);
    const col = weekend ? "color:#cc0000;" : "";
    const dl = day <= daysInMonth ? String(day) : "";
    const a1 = row ? hhmm(row.check_in) : "";
    const a2 = row ? hhmm(row.break_out) : "";
    const p1 = row ? hhmm(row.break_in) : "";
    const p2 = row ? hhmm(row.check_out) : "";
    rows31 += `<tr>
      ${cell(dl, col)}
      ${cell(a1)}
      ${cell(a2)}
      ${cell(p1)}
      ${cell(p2)}
    </tr>`;
  }

  const makeCopy = () => `
<table style="width:100%;border-collapse:collapse;table-layout:fixed;font-family:Arial,sans-serif;">
<colgroup>
  <col style="width:13%;"/>
  <col style="width:21.75%;"/>
  <col style="width:21.75%;"/>
  <col style="width:21.75%;"/>
  <col style="width:21.75%;"/>
</colgroup>
<tr>
  <td colspan="5" style="
    border-top:2.5pt double #000;
    border-bottom:2.5pt double #000;
    border-left:none;border-right:none;
    text-align:center;
    font-size:13pt;
    font-weight:bold;
    letter-spacing:1.5pt;
    padding:4px 0;
    font-family:Arial,sans-serif;
  ">DAILY TIME RECORD</td>
</tr>
<tr>
  <td colspan="5" style="
    text-align:center;
    font-size:10pt;
    font-weight:bold;
    border-bottom:1px solid #000;
    border-top:none;border-left:none;border-right:none;
    padding:3px 0 1px;
    font-family:Arial,sans-serif;
  ">${escapeHtml(fullName)}</td>
</tr>
<tr>
  <td colspan="5" style="
    font-size:8pt;
    border:none;
    padding:3px 0 4px;
    font-family:Arial,sans-serif;
  ">For the month of: &nbsp;<strong>${monthLabel}</strong></td>
</tr>
<tr>
  <td rowspan="2" style="
    border:1px solid #000;
    font-size:7.5pt;
    font-weight:bold;
    text-align:center;
    vertical-align:middle;
    padding:2px;
  ">Day</td>
  <td colspan="2" style="
    border:1px solid #000;
    font-size:7.5pt;
    font-weight:bold;
    text-align:center;
    vertical-align:middle;
    padding:2px;
  ">AM</td>
  <td colspan="2" style="
    border:1px solid #000;
    font-size:7.5pt;
    font-weight:bold;
    text-align:center;
    vertical-align:middle;
    padding:2px;
  ">PM</td>
</tr>
<tr>
  ${hdrCell("Time In")}
  ${hdrCell("Time Out")}
  ${hdrCell("Time In")}
  ${hdrCell("Time Out")}
</tr>
${rows31}
<tr>
  <td colspan="5" style="
    font-size:6.5pt;
    text-align:center;
    vertical-align:middle;
    border:none;
    padding:10px 4px 4px;
    line-height:1.8;
    font-family:Arial,sans-serif;
  ">
    I CERTIFY on my honor that above is a true and correct<br/>
    report of the hours of work performed, record of which was made<br/>
    daily at the time of arrival at and departure from office.
  </td>
</tr>
<tr>
  <td colspan="5" style="border:none;padding:20px 0 0;text-align:center;">
    <table style="width:80%;margin:0 auto;border-collapse:collapse;">
      <tr>
        <td style="border-top:1px solid #000;text-align:center;font-size:9.5pt;font-weight:bold;padding:4px 0 2px;font-family:Arial,sans-serif;">
          ${escapeHtml(fullName)}
        </td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td colspan="5" style="
    border:none;
    font-size:7.5pt;
    padding:6px 0 16px;
    text-align:center;
    font-family:Arial,sans-serif;
  ">Verified as to the prescribed office hours.</td>
</tr>
<tr>
  <td colspan="5" style="
    border:none;
    text-align:center;
    font-size:9.5pt;
    font-weight:bold;
    padding:2px 0 0;
    font-family:Arial,sans-serif;
  ">JOSE B. TUASON JR.</td>
</tr>
<tr>
  <td colspan="5" style="border:none;padding:0;text-align:center;">
    <table style="width:80%;margin:0 auto;border-collapse:collapse;">
      <tr>
        <td style="border-top:2pt solid #000;text-align:center;font-size:8.5pt;font-weight:bold;padding:4px 0 2px;font-family:Arial,sans-serif;">
          CHIEF ADMINISTRATIVE OFFICER
        </td>
      </tr>
    </table>
  </td>
</tr>
</table>`;

  const wordHtml = `
<html xmlns:o="urn:schemas-microsoft-com:office:office"
    xmlns:w="urn:schemas-microsoft-com:office:word"
    xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8"/>
<title>DTR – ${monthLabel}</title>
<!--[if gte mso 9]><xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml><![endif]-->
<style>
  @page {
    size: 21cm 29.7cm;
    margin: 10mm 8mm;
  }
  body {
    font-family: Arial, sans-serif;
    font-size: 9pt;
    color: #000;
    margin: 0;
    padding: 0;
  }
  table { border-collapse: collapse; }
</style>
</head>
<body>
<table style="width:100%;border-collapse:collapse;table-layout:fixed;">
  <colgroup>
    <col style="width:44%;"/>
    <col style="width:12%;"/>
    <col style="width:44%;"/>
  </colgroup>
  <tr>
    <td style="vertical-align:top;padding:0 8px 0 0;">${makeCopy()}</td>
    <td style="border-left:1px dashed #bbb;padding:0;"></td>
    <td style="vertical-align:top;padding:0 0 0 8px;">${makeCopy()}</td>
  </tr>
</table>
</body>
</html>`;

  const blob = new Blob(["\ufeff", wordHtml], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `DTR-${MONTHS[targetMonth]}-${targetYear}-${fullName.replace(/\s+/g, "_") || "trainee"}.doc`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main Dashboard ─────────────────────────────────────────────────────────────
function DashboardPage() {
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string>("");
  const [rows, setRows] = useState<DtrRow[]>([]);
  const [profile, setProfile] = useState<Profile>(EMPTY_PROFILE);
  const [profileDirty, setProfileDirty] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [targetInput, setTargetInput] = useState("");
  const [savingTarget, setSavingTarget] = useState(false);
  const [targetError, setTargetError] = useState("");
  const [now, setNow] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [accountInactive, setAccountInactive] = useState(false);
  const [savingAttendance, setSavingAttendance] = useState(false);
  const attendanceLock = useRef(false);
  const profileLock = useRef(false);
  const inactiveSessionLock = useRef(false);

  // Month/year the user wants to view/download the DTR for. This now also
  // drives which rows are shown in the table below (see visibleRows).
  const [downloadMonth, setDownloadMonth] = useState<number>(new Date().getMonth());
  const [downloadYear, setDownloadYear] = useState<number>(new Date().getFullYear());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const endInactiveSession = async () => {
    if (inactiveSessionLock.current) return false;
    inactiveSessionLock.current = true;
    setAccountInactive(true);
    setRows([]);
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
    return false;
  };

  const ensureActiveSession = async () => {
    if (!userId || accountInactive) return false;
    const { data, error } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", userId)
      .maybeSingle();
    if (error) {
      setActionError(`Your account status could not be checked. ${error.message}`);
      return false;
    }
    if (!data?.is_active) return endInactiveSession();
    return true;
  };

  useEffect(() => {
    (async () => {
      try {
        const { data: u } = await supabase.auth.getUser();
        if (!u.user) {
          navigate({ to: "/auth" });
          return;
        }
        setUserId(u.user.id);
        setEmail(u.user.email ?? "");

        const [profileResult, entriesResult] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", u.user.id).maybeSingle(),
          supabase
            .from("dtr_entries")
            .select("id, user_id, entry_date, check_in, break_out, break_in, check_out")
            .eq("user_id", u.user.id)
            .order("entry_date", { ascending: false }),
        ]);

        if (profileResult.error) throw profileResult.error;
        if (entriesResult.error) throw entriesResult.error;
        if (profileResult.data) {
          const loadedProfile = { ...EMPTY_PROFILE, ...profileResult.data };
          if (!loadedProfile.is_active) {
            setAccountInactive(true);
            setRows([]);
            await supabase.auth.signOut();
            navigate({ to: "/auth" });
            return;
          }
          setProfile(loadedProfile);
          setTargetInput(
            loadedProfile.required_ojt_hours == null
              ? ""
              : String(loadedProfile.required_ojt_hours),
          );
        }
        setRows((entriesResult.data as DtrRow[] | null) ?? []);
      } catch (error) {
        setLoadError(
          error instanceof Error ? error.message : "Unable to load your records. Please try again.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [navigate]);

  const key = todayKey();
  const today: DtrRow = useMemo(
    () =>
      rows.find((r) => r.entry_date === key) ?? {
        entry_date: key,
        check_in: null,
        break_out: null,
        break_in: null,
        check_out: null,
      },
    [rows, key],
  );

  // Strict, manual order — no auto "skip ahead" logic. Whatever hasn't been
  // punched yet, in order, is next.
  const nextPunch: Punch | null = useMemo(() => {
    for (const p of ORDER) {
      if (!today[p]) return p;
    }
    return null;
  }, [today]);

  const punch = async (p: Punch) => {
    if (!userId || attendanceLock.current || p !== nextPunch) return;
    if (!(await ensureActiveSession())) return;
    attendanceLock.current = true;
    setSavingAttendance(true);
    setActionError("");
    try {
      const nowIso = new Date().toISOString();
      // Compare the current timestamps before writing so another tab cannot
      // silently overwrite an already-saved punch.
      let query = today.id
        ? supabase
            .from("dtr_entries")
            .update(punchValue(p, nowIso))
            .eq("id", today.id)
            .eq("user_id", userId)
        : null;
      if (query)
        for (const field of ORDER) {
          query = today[field] ? query.eq(field, today[field]!) : query.is(field, null);
        }
      const { data, error } = await (
        query ??
        supabase.from("dtr_entries").insert({
          user_id: userId,
          entry_date: key,
          ...punchValue(p, nowIso),
        })
      )
        .select()
        .single();
      if (error)
        throw new Error(
          `Attendance was not saved. ${error.message} Refresh your records before retrying.`,
        );
      if (data) {
        setRows((prev) => {
          const other = prev.filter((r) => r.entry_date !== key);
          return [data as DtrRow, ...other];
        });
      }
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Attendance was not saved. Check your connection and try again.",
      );
    } finally {
      attendanceLock.current = false;
      setSavingAttendance(false);
    }
  };

  const undoLast = async () => {
    if (!userId || !today.id || attendanceLock.current) return;
    if (!(await ensureActiveSession())) return;
    const filled = ORDER.filter((p) => today[p]);
    const last = filled[filled.length - 1];
    if (!last) return;
    if (!window.confirm(`Undo ${LABELS[last]} at ${fmtTime(today[last])} for today?`)) return;
    attendanceLock.current = true;
    setSavingAttendance(true);
    setActionError("");
    try {
      let query = supabase
        .from("dtr_entries")
        .update(punchValue(last, null))
        .eq("id", today.id)
        .eq("user_id", userId);
      for (const field of ORDER)
        query = today[field] ? query.eq(field, today[field]!) : query.is(field, null);
      const { data, error } = await query.select().single();
      if (error)
        throw new Error(
          `Undo was not saved. ${error.message} Refresh your records before retrying.`,
        );
      setRows((prev) => prev.map((r) => (r.id === data.id ? data : r)));
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "Undo was not saved. Check your connection and try again.",
      );
    } finally {
      attendanceLock.current = false;
      setSavingAttendance(false);
    }
  };

  const saveProfile = async () => {
    if (!userId || profileLock.current) return;
    if (!(await ensureActiveSession())) return;
    const missing = missingProfileFields(profile);
    if (missing.length > 0) {
      setActionError(`Please complete the required trainee details: ${missing.join(", ")}.`);
      return;
    }
    profileLock.current = true;
    setSavingProfile(true);
    setActionError("");
    try {
      const { error } = await supabase
        .from("profiles")
        .upsert({
          id: userId,
          full_name: profile.full_name,
          student_id: profile.student_id,
          company: profile.company,
          ojt_title: profile.ojt_title,
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      setProfileDirty(false);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Profile was not saved. Please try again.",
      );
    } finally {
      profileLock.current = false;
      setSavingProfile(false);
    }
  };

  const saveTarget = async () => {
    if (!userId || savingTarget) return;
    if (!(await ensureActiveSession())) return;
    const value = targetInput.trim();
    const target = value === "" ? null : Number(value);
    if (target !== null && (!Number.isFinite(target) || target <= 0 || target > 10000)) {
      setTargetError("Enter a required OJT target between 0 and 10,000 hours.");
      return;
    }

    setSavingTarget(true);
    setTargetError("");
    const { data, error } = await supabase
      .from("profiles")
      .update({ required_ojt_hours: target })
      .eq("id", userId)
      .select("required_ojt_hours")
      .single();
    if (error) {
      setTargetError(`Target was not saved. ${error.message}`);
    } else {
      const savedTarget = data.required_ojt_hours;
      setProfile((current) => ({ ...current, required_ojt_hours: savedTarget }));
      setTargetInput(savedTarget == null ? "" : String(savedTarget));
    }
    setSavingTarget(false);
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      setActionError(error.message);
      return;
    }
    navigate({ to: "/auth" });
  };

  // Only the rows for the currently selected month/year — this is what the
  // Daily Time Record table on screen renders, so the table always matches
  // whatever month is picked in the dropdown above it.
  const visibleRows = useMemo(
    () => filterRowsByMonth(rows, downloadMonth, downloadYear),
    [rows, downloadMonth, downloadYear],
  );

  const exportCsv = async () => {
    if (!(await ensureActiveSession())) return;
    const csvRows = [
      ["Date", "Check In", "Break Out", "Break In", "Check Out", "Hours"],
      ...visibleRows.map((r) => [
        r.entry_date,
        fmtTime(r.check_in),
        fmtTime(r.break_out),
        fmtTime(r.break_in),
        fmtTime(r.check_out),
        computeHours(r).toFixed(2),
      ]),
    ];
    const csv = csvRows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dtr-${MONTHS[downloadMonth]}-${downloadYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Trainee's print/download now just delegate to the shared standalone
  // functions defined above the component, passing this trainee's own data.
  // These still receive the FULL `rows` (not visibleRows) since the document
  // builder itself does its own month/year filtering internally.
  const printDtr = async () => {
    if (!(await ensureActiveSession())) return;
    printDtrFor(profile.full_name || "", rows, downloadMonth, downloadYear);
  };

  const downloadWordDtr = async () => {
    if (!(await ensureActiveSession())) return;
    downloadWordDtrFor(profile.full_name || "", rows, downloadMonth, downloadYear);
  };

  const totalHours = useMemo(
    () => visibleRows.reduce((s, r) => s + computeHours(r), 0),
    [visibleRows],
  );

  const completedOjtHours = useMemo(() => calculateCompletedHoursFromRecords(rows), [rows]);
  const ojtProgress = useMemo(
    () =>
      profile.required_ojt_hours == null
        ? null
        : calculateOjtProgress(profile.required_ojt_hours, completedOjtHours),
    [profile.required_ojt_hours, completedOjtHours],
  );
  const targetDirty =
    targetInput !== (profile.required_ojt_hours == null ? "" : String(profile.required_ojt_hours));

  // Build a list of years available for selection, based on existing rows
  // (plus the current year), so the dropdown always has something sensible.
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    years.add(new Date().getFullYear());
    for (const r of rows) {
      const y = new Date(r.entry_date + "T00:00:00").getFullYear();
      years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [rows]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 sm:py-5">
          <div className="flex items-center gap-3">
            <img
              src={psaLogo}
              alt="Philippine Statistics Authority"
              className="h-10 w-10 shrink-0 rounded-full object-contain sm:h-12 sm:w-12"
            />
            <div>
              <h1 className="text-lg font-semibold tracking-tight text-slate-900 sm:text-xl">
                OJT Attendance · {profile.is_admin ? "Admin" : "DTR"}
              </h1>
              <p className="text-xs text-slate-500">
                Signed in as {profile.full_name || email}
                {profile.is_admin && (
                  <span className="ml-2 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Admin
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4 sm:justify-end">
            <div className="text-left sm:text-right">
              <div className="font-mono text-xl font-semibold text-slate-900 sm:text-2xl">
                {now.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </div>
              <div className="text-xs text-slate-500">
                {now.toLocaleDateString(undefined, {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </div>
            </div>
            <Link to="/reset-password" className="text-xs font-medium text-slate-600 underline">
              Change password
            </Link>
            <button
              onClick={signOut}
              className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 px-3 py-5 sm:space-y-6 sm:px-6 sm:py-8">
        {actionError && (
          <p
            role="alert"
            className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          >
            {actionError}
          </p>
        )}
        {loading ? (
          <div className="rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
            Loading…
          </div>
        ) : loadError ? (
          <div role="alert" className="rounded border border-red-200 bg-white p-5 text-red-700">
            <p>{loadError}</p>
            <button className="mt-2 underline" onClick={() => window.location.reload()}>
              Reload records
            </button>
          </div>
        ) : profile.is_admin ? (
          <AdminDashboard />
        ) : (
          <>
            {/* Profile */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">Trainee details</h2>
                {profileDirty && (
                  <button
                    onClick={saveProfile}
                    disabled={savingProfile}
                    className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                  >
                    {savingProfile ? "Saving…" : "Save"}
                  </button>
                )}
              </div>
              {missingProfileFields(profile).length > 0 && (
                <p
                  role="status"
                  className="mb-3 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
                >
                  Complete your required trainee details ({missingProfileFields(profile).join(", ")}
                  ) to keep your profile information up to date. Your existing attendance records
                  remain available.
                </p>
              )}
              <fieldset
                disabled={savingProfile}
                className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              >
                <ProfileField
                  label="Full Name"
                  required
                  value={profile.full_name ?? ""}
                  onChange={(v) => {
                    setProfile({ ...profile, full_name: v });
                    setProfileDirty(true);
                  }}
                  placeholder="Juan Dela Cruz"
                />
                <ProfileField
                  label="Student ID"
                  required
                  value={profile.student_id ?? ""}
                  onChange={(v) => {
                    setProfile({ ...profile, student_id: v });
                    setProfileDirty(true);
                  }}
                  placeholder="2024-00001"
                />
                <ProfileField
                  label="Host Company"
                  required
                  value={profile.company ?? ""}
                  onChange={(v) => {
                    setProfile({ ...profile, company: v });
                    setProfileDirty(true);
                  }}
                  placeholder="Acme Corp."
                />
                <ProfileField
                  label="OJT Title"
                  required
                  value={profile.ojt_title ?? ""}
                  onChange={(v) => {
                    setProfile({ ...profile, ojt_title: v });
                    setProfileDirty(true);
                  }}
                  placeholder="Data Analyst Intern"
                />
              </fieldset>
            </section>

            {/* OJT progress */}
            <section
              aria-labelledby="ojt-progress-heading"
              className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 id="ojt-progress-heading" className="text-sm font-semibold text-slate-900">
                    OJT progress
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Completed hours use every complete DTR day in your account.
                  </p>
                </div>
                <div className="flex items-end gap-2">
                  <label className="block">
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Required hours
                    </span>
                    <input
                      type="number"
                      min="0.01"
                      max="10000"
                      step="0.01"
                      aria-label="Required OJT hours"
                      value={targetInput}
                      onChange={(e) => {
                        setTargetInput(e.target.value);
                        setTargetError("");
                      }}
                      placeholder="486"
                      className="mt-1 w-28 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                    />
                  </label>
                  {targetDirty && (
                    <button
                      onClick={saveTarget}
                      disabled={savingTarget}
                      className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {savingTarget ? "Saving…" : "Save target"}
                    </button>
                  )}
                </div>
              </div>

              {targetError && (
                <p
                  role="alert"
                  className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700"
                >
                  {targetError}
                </p>
              )}

              {ojtProgress ? (
                <>
                  <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <ProgressStat
                      label="Required"
                      value={`${ojtProgress.requiredHours.toFixed(2)} hrs`}
                    />
                    <ProgressStat
                      label="Completed"
                      value={`${ojtProgress.completedHours.toFixed(2)} hrs`}
                    />
                    <ProgressStat
                      label="Remaining"
                      value={`${ojtProgress.remainingHours.toFixed(2)} hrs`}
                    />
                    <ProgressStat
                      label="Complete"
                      value={`${ojtProgress.completionPercentage.toFixed(1)}%`}
                    />
                  </div>
                  <div className="mt-4">
                    <div
                      role="progressbar"
                      aria-label="OJT completion"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.min(100, ojtProgress.completionPercentage)}
                      className="h-3 overflow-hidden rounded-full bg-slate-100"
                    >
                      <div
                        className={`h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none ${
                          ojtProgress.isComplete
                            ? "bg-emerald-500 motion-safe:animate-pulse"
                            : "bg-slate-900"
                        }`}
                        style={{
                          width: `${Math.min(100, Math.max(0, ojtProgress.completionPercentage))}%`,
                        }}
                      />
                    </div>
                  </div>
                  {ojtProgress.isComplete && (
                    <p
                      aria-live="polite"
                      className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 motion-safe:animate-pulse"
                    >
                      <span aria-hidden="true">✦ </span>
                      OJT target reached!
                      {ojtProgress.overageHours > 0 &&
                        ` ${ojtProgress.overageHours.toFixed(2)} hours beyond your target.`}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-5 rounded-md bg-slate-50 px-3 py-3 text-sm text-slate-600">
                  Set your required OJT hours to start tracking your completion progress.
                </p>
              )}
            </section>

            {/* Punch card */}
            <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
              <div className="mb-5 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Today · {fmtDate(key)}
                </h2>
                <button
                  onClick={undoLast}
                  disabled={savingAttendance || !today.id || !ORDER.some((p) => today[p])}
                  className="shrink-0 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Undo last
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {ORDER.map((p) => {
                  const done = Boolean(today[p]);
                  const isNext = nextPunch === p;
                  return (
                    <div
                      key={p}
                      className={`rounded-lg border p-3 sm:p-4 ${
                        done
                          ? "border-emerald-200 bg-emerald-50"
                          : isNext
                            ? "border-slate-300 bg-white"
                            : "border-slate-200 bg-slate-50 opacity-70"
                      }`}
                    >
                      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:text-xs">
                        {LABELS[p]}
                      </div>
                      <div className="mt-1 font-mono text-base font-semibold text-slate-900 sm:text-lg">
                        {fmtTime(today[p])}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                {nextPunch ? (
                  <button
                    onClick={() => punch(nextPunch)}
                    disabled={savingAttendance}
                    className="w-full rounded-md bg-slate-900 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:py-2.5"
                  >
                    {savingAttendance ? "Saving…" : `${LABELS[nextPunch]} now`}
                  </button>
                ) : (
                  <div className="rounded-md bg-emerald-100 px-4 py-2 text-sm font-medium text-emerald-800">
                    Day complete · {computeHours(today).toFixed(2)} hrs
                  </div>
                )}
                <span className="text-xs text-slate-500">
                  Tap each button yourself — Break Out, Break In, and Check Out are no longer logged
                  automatically.
                </span>
              </div>
            </section>

            {/* DTR table */}
            <section className="rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Daily Time Record</h2>
                  <p className="text-xs text-slate-500">
                    {MONTHS[downloadMonth]} {downloadYear} · Total logged: {totalHours.toFixed(2)}{" "}
                    hrs across {visibleRows.length} day{visibleRows.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                  {/* Month/year picker — now filters the table too, not just downloads */}
                  <select
                    value={downloadMonth}
                    onChange={(e) => setDownloadMonth(Number(e.target.value))}
                    className="col-span-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-slate-400"
                    aria-label="Select month to view/download"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <select
                    value={downloadYear}
                    onChange={(e) => setDownloadYear(Number(e.target.value))}
                    className="col-span-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-slate-400"
                    aria-label="Select year to view/download"
                  >
                    {availableYears.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={exportCsv}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Export CSV
                  </button>
                  <button
                    onClick={printDtr}
                    className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Print DTR
                  </button>
                  <button
                    onClick={downloadWordDtr}
                    className="col-span-2 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:col-span-1"
                  >
                    Download Word
                  </button>
                </div>
              </div>

              {/* Mobile: card list */}
              <div className="divide-y divide-slate-100 sm:hidden">
                {visibleRows.length === 0 && (
                  <p className="px-4 py-10 text-center text-sm text-slate-400">
                    No records for {MONTHS[downloadMonth]} {downloadYear}.
                  </p>
                )}
                {visibleRows.map((r) => {
                  const h = computeHours(r);
                  return (
                    <div key={r.entry_date} className="px-4 py-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-900">
                          {fmtDate(r.entry_date)}
                        </span>
                        <span className="font-mono text-xs text-slate-500">
                          {h ? `${h.toFixed(2)} hrs` : "—"}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600">
                        <div>
                          <span className="text-slate-400">Check In: </span>
                          <span className="font-mono">{fmtTime(r.check_in)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Break Out: </span>
                          <span className="font-mono">{fmtTime(r.break_out)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Break In: </span>
                          <span className="font-mono">{fmtTime(r.break_in)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">Check Out: </span>
                          <span className="font-mono">{fmtTime(r.check_out)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop/tablet: table */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-5 py-3 font-medium">Check In</th>
                      <th className="px-5 py-3 font-medium">Break Out</th>
                      <th className="px-5 py-3 font-medium">Break In</th>
                      <th className="px-5 py-3 font-medium">Check Out</th>
                      <th className="px-5 py-3 text-right font-medium">Hours</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleRows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-400">
                          No records for {MONTHS[downloadMonth]} {downloadYear}.
                        </td>
                      </tr>
                    )}
                    {visibleRows.map((r) => {
                      const h = computeHours(r);
                      return (
                        <tr key={r.entry_date} className="text-slate-700">
                          <td className="px-5 py-3 font-medium text-slate-900">
                            {fmtDate(r.entry_date)}
                          </td>
                          <td className="px-5 py-3 font-mono">{fmtTime(r.check_in)}</td>
                          <td className="px-5 py-3 font-mono">{fmtTime(r.break_out)}</td>
                          <td className="px-5 py-3 font-mono">{fmtTime(r.break_in)}</td>
                          <td className="px-5 py-3 font-mono">{fmtTime(r.check_out)}</td>
                          <td className="px-5 py-3 text-right font-mono">
                            {h ? h.toFixed(2) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function ProfileField({
  label,
  required = false,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  required?: boolean;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
        {required && (
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        )}
      </span>
      <input
        required={required}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
      />
    </label>
  );
}

// ── Admin Dashboard ──────────────────────────────────────────────────────────
// Shown instead of the trainee punch-in UI when profile.is_admin is true.
// Lets an admin browse every trainee and view/manage their DTR entries.
// Requires RLS SELECT (and optionally UPDATE/DELETE) policies on `profiles`
// and `dtr_entries` that allow rows where the caller's own profile has
// is_admin = true. See setup notes below the component.

type TraineeDtr = DtrRow & { user_id: string };

function ProgressStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function AdminDashboard() {
  const createAccount = useServerFn(createTraineeAccount);
  const mutationLock = useRef(false);
  const requestVersion = useRef(0);
  const [mutating, setMutating] = useState(false);
  const [trainees, setTrainees] = useState<TraineeRow[]>([]);
  const [loadingTrainees, setLoadingTrainees] = useState(true);
  const [traineeError, setTraineeError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entries, setEntries] = useState<TraineeDtr[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [entriesError, setEntriesError] = useState<string | null>(null);

  const [search, setSearch] = useState("");

  // Month/year the admin wants to view/print/download for the selected
  // trainee. This now also drives which rows are shown in the table below.
  const [docMonth, setDocMonth] = useState<number>(new Date().getMonth());
  const [docYear, setDocYear] = useState<number>(new Date().getFullYear());
  const [editFullName, setEditFullName] = useState("");
  const [editStudentId, setEditStudentId] = useState("");
  const [editCompany, setEditCompany] = useState("");
  const [editOjtTitle, setEditOjtTitle] = useState("");
  const [requiredHoursInput, setRequiredHoursInput] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileEditError, setProfileEditError] = useState("");
  const [profileEditSuccess, setProfileEditSuccess] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);
  const [statusError, setStatusError] = useState("");
  const [statusSuccess, setStatusSuccess] = useState("");
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [createFullName, setCreateFullName] = useState("");
  const [createStudentId, setCreateStudentId] = useState("");
  const [createCompany, setCreateCompany] = useState("");
  const [createOjtTitle, setCreateOjtTitle] = useState("");
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createPasswordConfirm, setCreatePasswordConfirm] = useState("");
  const [createRequiredHours, setCreateRequiredHours] = useState("");
  const [createError, setCreateError] = useState("");
  const [createSuccess, setCreateSuccess] = useState("");

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "id, full_name, student_id, company, ojt_title, required_ojt_hours, is_admin, is_active",
        )
        .order("full_name", { ascending: true });
      if (error) {
        setTraineeError(error.message);
      } else {
        setTrainees((data as TraineeRow[]) ?? []);
      }
      setLoadingTrainees(false);
    })();
  }, []);

  const createAccountSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fullName = createFullName.trim();
    const studentId = createStudentId.trim();
    const company = createCompany.trim();
    const ojtTitle = createOjtTitle.trim();
    const email = createEmail.trim().toLowerCase();
    const requiredOjtHours = createRequiredHours.trim();
    const target = requiredOjtHours === "" ? null : Number(requiredOjtHours);
    const missing = [
      !fullName && "Full Name",
      !studentId && "Student ID",
      !company && "Host Company",
      !ojtTitle && "OJT Title",
      !email && "Email",
      !createPassword && "Temporary password",
    ].filter(Boolean) as string[];

    setCreateError("");
    setCreateSuccess("");
    if (missing.length > 0) {
      setCreateError(`Complete the required fields: ${missing.join(", ")}.`);
      return;
    }
    if (createPassword !== createPasswordConfirm) {
      setCreateError("Temporary passwords do not match.");
      return;
    }
    if (target !== null && (!Number.isFinite(target) || target <= 0 || target > 10000)) {
      setCreateError("Enter a target between 0 and 10,000 hours, or leave it blank.");
      return;
    }

    setCreatingAccount(true);
    try {
      const { profile: createdProfile } = await createAccount({
        data: {
          email,
          password: createPassword,
          fullName,
          studentId,
          company,
          ojtTitle,
          requiredOjtHours: target,
        },
      });
      const profile = createdProfile as CreatedTraineeProfile;
      setTrainees((current) =>
        [...current, profile as TraineeRow].sort((a, b) =>
          (a.full_name ?? "").localeCompare(b.full_name ?? ""),
        ),
      );
      ++requestVersion.current;
      setSelectedId(profile.id);
      setEntries([]);
      setLoadingEntries(false);
      setEntriesError(null);
      setEditFullName(profile.full_name ?? "");
      setEditStudentId(profile.student_id ?? "");
      setEditCompany(profile.company ?? "");
      setEditOjtTitle(profile.ojt_title ?? "");
      setRequiredHoursInput(
        profile.required_ojt_hours == null ? "" : String(profile.required_ojt_hours),
      );
      setCreateFullName("");
      setCreateStudentId("");
      setCreateCompany("");
      setCreateOjtTitle("");
      setCreateEmail("");
      setCreatePassword("");
      setCreatePasswordConfirm("");
      setCreateRequiredHours("");
      setCreateSuccess(`Account created for ${profile.full_name || email}.`);
    } catch (error) {
      setCreateError(
        error instanceof Error ? error.message : "Account was not created. Please try again.",
      );
    } finally {
      setCreatingAccount(false);
    }
  };

  const loadEntries = async (userId: string) => {
    const version = ++requestVersion.current;
    const trainee = trainees.find((row) => row.id === userId);
    setSelectedId(userId);
    setEditFullName(trainee?.full_name ?? "");
    setEditStudentId(trainee?.student_id ?? "");
    setEditCompany(trainee?.company ?? "");
    setEditOjtTitle(trainee?.ojt_title ?? "");
    setRequiredHoursInput(
      trainee?.required_ojt_hours == null ? "" : String(trainee.required_ojt_hours),
    );
    setProfileEditError("");
    setProfileEditSuccess("");
    setStatusError("");
    setStatusSuccess("");
    setEntries([]);
    setLoadingEntries(true);
    setEntriesError(null);
    const { data, error } = await supabase
      .from("dtr_entries")
      .select("id, user_id, entry_date, check_in, break_out, break_in, check_out")
      .eq("user_id", userId)
      .order("entry_date", { ascending: false });
    if (version !== requestVersion.current) return;
    if (error) {
      setEntriesError(error.message);
      setEntries([]);
    } else {
      setEntries((data as TraineeDtr[]) ?? []);
    }
    setLoadingEntries(false);
  };

  const deleteEntry = async (entryId: string) => {
    if (mutationLock.current) return;
    if (!window.confirm("Delete this DTR entry? This cannot be undone.")) return;
    mutationLock.current = true;
    setMutating(true);
    try {
      const { error } = await supabase
        .from("dtr_entries")
        .delete()
        .eq("id", entryId)
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      setEntries((prev) => prev.filter((e) => e.id !== entryId));
    } catch (error) {
      window.alert(
        `Failed to delete: ${error instanceof Error ? error.message : "Check your connection and retry."}`,
      );
    } finally {
      mutationLock.current = false;
      setMutating(false);
    }
  };

  const clearPunch = async (entryId: string, field: Punch) => {
    if (mutationLock.current) return;
    const entry = entries.find((r) => r.id === entryId);
    if (!entry?.[field]) return;
    if (
      !window.confirm(`Clear ${LABELS[field]} at ${fmtTime(entry[field])} on ${entry.entry_date}?`)
    )
      return;
    mutationLock.current = true;
    setMutating(true);
    try {
      const { data, error } = await supabase
        .from("dtr_entries")
        .update(punchValue(field, null))
        .eq("id", entryId)
        .eq(field, entry[field]!)
        .select()
        .single();
      if (error) throw new Error(error.message);
      setEntries((prev) => prev.map((e) => (e.id === entryId ? data : e)));
    } catch (error) {
      window.alert(
        `Failed to update: ${error instanceof Error ? error.message : "Check your connection and retry."}`,
      );
    } finally {
      mutationLock.current = false;
      setMutating(false);
    }
  };

  const saveTraineeProfile = async () => {
    if (!selectedTrainee || savingProfile) return;
    const version = requestVersion.current;
    const fullName = editFullName.trim();
    const studentId = editStudentId.trim();
    const company = editCompany.trim();
    const ojtTitle = editOjtTitle.trim();
    const value = requiredHoursInput.trim();
    const target = value === "" ? null : Number(value);
    const missing = [
      !fullName && "Full Name",
      !studentId && "Student ID",
      !company && "Host Company",
      !ojtTitle && "OJT Title",
    ].filter(Boolean) as string[];
    if (missing.length > 0) {
      setProfileEditError(`Complete the required fields: ${missing.join(", ")}.`);
      setProfileEditSuccess("");
      return;
    }
    if (target !== null && (!Number.isFinite(target) || target <= 0 || target > 10000)) {
      setProfileEditError("Enter a target between 0 and 10,000 hours, or leave it blank.");
      setProfileEditSuccess("");
      return;
    }

    setSavingProfile(true);
    setProfileEditError("");
    setProfileEditSuccess("");
    const { data, error } = await supabase.rpc("dtr_admin_update_trainee_profile", {
      target_user_id: selectedTrainee.id,
      new_full_name: fullName,
      new_student_id: studentId,
      new_company: company,
      new_ojt_title: ojtTitle,
      new_required_ojt_hours: target,
    });
    if (error) {
      if (version === requestVersion.current)
        setProfileEditError(`Profile was not saved. ${error.message}`);
    } else if (data) {
      setTrainees((current) =>
        current.map((trainee) =>
          trainee.id === selectedTrainee.id
            ? {
                ...trainee,
                full_name: data.full_name,
                student_id: data.student_id,
                company: data.company,
                ojt_title: data.ojt_title,
                required_ojt_hours: data.required_ojt_hours,
                is_admin: data.is_admin,
              }
            : trainee,
        ),
      );
      if (version === requestVersion.current) {
        setEditFullName(data.full_name ?? "");
        setEditStudentId(data.student_id ?? "");
        setEditCompany(data.company ?? "");
        setEditOjtTitle(data.ojt_title ?? "");
        setRequiredHoursInput(
          data.required_ojt_hours == null ? "" : String(data.required_ojt_hours),
        );
        setProfileEditSuccess("Trainee profile saved.");
      }
    }
    setSavingProfile(false);
  };

  const setAccountActive = async () => {
    if (!selectedTrainee || savingStatus) return;
    const version = requestVersion.current;
    const nextActive = !selectedTrainee.is_active;
    if (
      !nextActive &&
      !window.confirm(
        "Deactivate this trainee account? Their profile and attendance history will be preserved, but they will be signed out and blocked from DTR operations.",
      )
    )
      return;

    setSavingStatus(true);
    setStatusError("");
    setStatusSuccess("");
    setProfileEditSuccess("");
    const { data, error } = await supabase.rpc("dtr_admin_set_account_active", {
      target_user_id: selectedTrainee.id,
      target_active: nextActive,
    });
    if (error) {
      if (version === requestVersion.current)
        setStatusError(`Account status was not changed. ${error.message}`);
    } else if (data) {
      setTrainees((current) =>
        current.map((trainee) =>
          trainee.id === selectedTrainee.id ? { ...trainee, is_active: data.is_active } : trainee,
        ),
      );
      if (version === requestVersion.current)
        setStatusSuccess(data.is_active ? "Account reactivated." : "Account deactivated.");
    }
    setSavingStatus(false);
  };

  const selectedTrainee = trainees.find((t) => t.id === selectedId);

  const filteredTrainees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return trainees;
    return trainees.filter((t) =>
      [t.full_name, t.student_id, t.company, t.ojt_title]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(q)),
    );
  }, [trainees, search]);

  // Only the selected trainee's rows for the currently selected month/year —
  // this is what the table below renders, kept in sync with the dropdowns.
  const visibleEntries = useMemo(
    () => filterRowsByMonth(entries, docMonth, docYear),
    [entries, docMonth, docYear],
  );

  const selectedTotalHours = useMemo(
    () => visibleEntries.reduce((s, r) => s + computeHours(r), 0),
    [visibleEntries],
  );

  const exportSelectedCsv = () => {
    if (!selectedTrainee) return;
    const csvRows = [
      ["Date", "Check In", "Break Out", "Break In", "Check Out", "Hours"],
      ...visibleEntries.map((r) => [
        r.entry_date,
        fmtTime(r.check_in),
        fmtTime(r.break_out),
        fmtTime(r.break_in),
        fmtTime(r.check_out),
        computeHours(r).toFixed(2),
      ]),
    ];
    const csv = csvRows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dtr-${(selectedTrainee.full_name || selectedTrainee.id).replace(/\s+/g, "_")}-${MONTHS[docMonth]}-${docYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Years available in the picker, based on the selected trainee's own
  // entries (plus the current year), same approach as the trainee dashboard.
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    years.add(new Date().getFullYear());
    for (const r of entries) {
      const y = new Date(r.entry_date + "T00:00:00").getFullYear();
      years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [entries]);

  const printSelectedDtr = () => {
    if (!selectedTrainee) return;
    printDtrFor(selectedTrainee.full_name || "", entries, docMonth, docYear);
  };

  const downloadSelectedWordDtr = () => {
    if (!selectedTrainee) return;
    downloadWordDtrFor(selectedTrainee.full_name || "", entries, docMonth, docYear);
  };

  return (
    <section aria-labelledby="manage-accounts-heading" className="space-y-3">
      <div>
        <h2 id="manage-accounts-heading" className="text-base font-semibold text-slate-900">
          Manage Accounts
        </h2>
        <p className="text-xs text-slate-500">
          View trainee details and update permitted profile information. Account deletion is not
          available here.
        </p>
      </div>
      <form
        onSubmit={createAccountSubmit}
        data-admin-create-account-endpoint={createTraineeAccount.url}
        className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"
      >
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-slate-900">Create trainee account</h3>
          <p className="mt-1 text-xs text-slate-500">
            Set the trainee&apos;s sign-in details and profile. The account is active immediately.
          </p>
        </div>
        <fieldset disabled={creatingAccount} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Full Name</span>
            <input
              required
              aria-label="New trainee full name"
              value={createFullName}
              onChange={(e) => {
                setCreateFullName(e.target.value);
                setCreateError("");
                setCreateSuccess("");
              }}
              placeholder="Juan Dela Cruz"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Student ID</span>
            <input
              required
              aria-label="New trainee student ID"
              value={createStudentId}
              onChange={(e) => {
                setCreateStudentId(e.target.value);
                setCreateError("");
                setCreateSuccess("");
              }}
              placeholder="2024-00001"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Host Company</span>
            <input
              required
              aria-label="New trainee host company"
              value={createCompany}
              onChange={(e) => {
                setCreateCompany(e.target.value);
                setCreateError("");
                setCreateSuccess("");
              }}
              placeholder="Philippine Statistics Authority"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">OJT Title</span>
            <input
              required
              aria-label="New trainee OJT title"
              value={createOjtTitle}
              onChange={(e) => {
                setCreateOjtTitle(e.target.value);
                setCreateError("");
                setCreateSuccess("");
              }}
              placeholder="Data Analyst Intern"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Email</span>
            <input
              required
              type="email"
              aria-label="New trainee email"
              autoComplete="off"
              value={createEmail}
              onChange={(e) => {
                setCreateEmail(e.target.value);
                setCreateError("");
                setCreateSuccess("");
              }}
              placeholder="trainee@school.edu"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Temporary password</span>
            <input
              required
              type="password"
              minLength={8}
              maxLength={72}
              aria-label="New trainee temporary password"
              autoComplete="new-password"
              value={createPassword}
              onChange={(e) => {
                setCreatePassword(e.target.value);
                setCreateError("");
                setCreateSuccess("");
              }}
              placeholder="At least 8 characters"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Confirm password</span>
            <input
              required
              type="password"
              minLength={8}
              maxLength={72}
              aria-label="Confirm new trainee password"
              autoComplete="new-password"
              value={createPasswordConfirm}
              onChange={(e) => {
                setCreatePasswordConfirm(e.target.value);
                setCreateError("");
                setCreateSuccess("");
              }}
              placeholder="Repeat the password"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">Required OJT hours</span>
            <input
              type="number"
              min="0.01"
              max="10000"
              step="0.01"
              aria-label="New trainee required OJT hours"
              value={createRequiredHours}
              onChange={(e) => {
                setCreateRequiredHours(e.target.value);
                setCreateError("");
                setCreateSuccess("");
              }}
              placeholder="486"
              className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
            />
          </label>
        </fieldset>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={creatingAccount}
            className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {creatingAccount ? "Creating..." : "Create trainee account"}
          </button>
          {createError && (
            <p role="alert" className="text-xs text-red-600">
              {createError}
            </p>
          )}
          {createSuccess && (
            <p role="status" className="text-xs text-emerald-700">
              {createSuccess}
            </p>
          )}
        </div>
      </form>
      <fieldset
        disabled={mutating}
        aria-busy={mutating}
        className="grid min-w-0 gap-4 sm:gap-6 lg:grid-cols-[300px_1fr]"
      >
        {/* Account list */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Accounts {trainees.length > 0 && `(${trainees.length})`}
            </h2>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, ID, company…"
            className="mb-3 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 outline-none focus:border-slate-400"
          />
          {traineeError && (
            <p className="mb-2 text-xs text-red-600">
              Couldn't load accounts: {traineeError}. Check your RLS policy allows admins to select
              all profiles.
            </p>
          )}
          {loadingTrainees ? (
            <p className="text-xs text-slate-400">Loading…</p>
          ) : filteredTrainees.length === 0 ? (
            <p className="text-xs text-slate-400">No accounts found.</p>
          ) : (
            <ul className="max-h-[50vh] space-y-1 overflow-y-auto lg:max-h-[70vh]">
              {filteredTrainees.map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => loadEntries(t.id)}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm transition ${
                      selectedId === t.id
                        ? "bg-slate-900 text-white"
                        : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <div className="font-medium">{t.full_name || "Unnamed"}</div>
                    <div
                      className={`text-xs ${
                        selectedId === t.id ? "text-slate-300" : "text-slate-400"
                      }`}
                    >
                      {t.student_id || "No ID"} · {t.company || "No company"}
                    </div>
                    <div
                      className={`text-xs ${
                        selectedId === t.id ? "text-slate-300" : "text-slate-400"
                      }`}
                    >
                      {t.ojt_title ? `OJT: ${t.ojt_title}` : "OJT title incomplete"}
                    </div>
                    <div
                      className={`text-xs ${
                        selectedId === t.id ? "text-slate-300" : "text-slate-400"
                      }`}
                    >
                      {t.required_ojt_hours == null
                        ? "OJT target not set"
                        : `Target: ${t.required_ojt_hours} hrs`}
                    </div>
                    <div
                      className={`text-xs font-medium ${
                        selectedId === t.id
                          ? t.is_active
                            ? "text-emerald-300"
                            : "text-amber-300"
                          : t.is_active
                            ? "text-emerald-600"
                            : "text-amber-600"
                      }`}
                    >
                      {t.is_active ? "Active account" : "Inactive account"}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Selected trainee's DTR */}
        <div className="rounded-xl border border-slate-200 bg-white">
          <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:px-5">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                {selectedTrainee
                  ? `${selectedTrainee.full_name || "Unnamed"}'s DTR`
                  : "Select a trainee"}
              </h2>
              {selectedTrainee && (
                <p className="text-xs text-slate-500">
                  {selectedTrainee.student_id || "No ID"}
                  {" \u00b7 "}
                  {selectedTrainee.company || "No company"}
                  {" \u00b7 "}
                  {selectedTrainee.ojt_title || "No OJT title"}
                  {" \u00b7 "}
                  {MONTHS[docMonth]} {docYear}
                  {" \u00b7 "}
                  Total: {selectedTotalHours.toFixed(2)} hrs across {visibleEntries.length} day
                  {visibleEntries.length === 1 ? "" : "s"}
                </p>
              )}
              {selectedTrainee && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Trainee profile
                    </h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Update profile details and the school-specific OJT target.
                    </p>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">Full Name</span>
                      <input
                        value={editFullName}
                        onChange={(e) => {
                          setEditFullName(e.target.value);
                          setProfileEditError("");
                          setProfileEditSuccess("");
                        }}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">Student ID</span>
                      <input
                        value={editStudentId}
                        onChange={(e) => {
                          setEditStudentId(e.target.value);
                          setProfileEditError("");
                          setProfileEditSuccess("");
                        }}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">Host Company</span>
                      <input
                        value={editCompany}
                        onChange={(e) => {
                          setEditCompany(e.target.value);
                          setProfileEditError("");
                          setProfileEditSuccess("");
                        }}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    </label>
                    <label className="block">
                      <span className="text-xs font-medium text-slate-600">OJT Title</span>
                      <input
                        value={editOjtTitle}
                        onChange={(e) => {
                          setEditOjtTitle(e.target.value);
                          setProfileEditError("");
                          setProfileEditSuccess("");
                        }}
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    </label>
                    <label className="block sm:col-span-2">
                      <span className="text-xs font-medium text-slate-600">Required OJT hours</span>
                      <input
                        type="number"
                        min="0.01"
                        max="10000"
                        step="0.01"
                        aria-label="Required OJT hours"
                        value={requiredHoursInput}
                        onChange={(e) => {
                          setRequiredHoursInput(e.target.value);
                          setProfileEditError("");
                          setProfileEditSuccess("");
                        }}
                        placeholder="486"
                        className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-400"
                      />
                    </label>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
                    <div className="mr-auto">
                      <div className="text-xs font-medium text-slate-600">Account status</div>
                      <div
                        className={`text-sm font-semibold ${
                          selectedTrainee.is_active ? "text-emerald-700" : "text-amber-700"
                        }`}
                      >
                        {selectedTrainee.is_active ? "Active" : "Inactive"}
                      </div>
                    </div>
                    <button
                      onClick={setAccountActive}
                      disabled={savingStatus || selectedTrainee.is_admin}
                      className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {savingStatus
                        ? "Saving..."
                        : selectedTrainee.is_active
                          ? "Deactivate account"
                          : "Reactivate account"}
                    </button>
                    {statusError && (
                      <p role="alert" className="basis-full text-xs text-red-600">
                        {statusError}
                      </p>
                    )}
                    {statusSuccess && (
                      <p role="status" className="basis-full text-xs text-emerald-700">
                        {statusSuccess}
                      </p>
                    )}
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <button
                      onClick={saveTraineeProfile}
                      disabled={savingProfile}
                      className="rounded-md bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-60"
                    >
                      {savingProfile ? "Saving..." : "Save trainee profile"}
                    </button>
                    {profileEditError && (
                      <p role="alert" className="text-xs text-red-600">
                        {profileEditError}
                      </p>
                    )}
                    {profileEditSuccess && (
                      <p role="status" className="text-xs text-emerald-700">
                        {profileEditSuccess}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
            {selectedTrainee && entries.length > 0 && (
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <select
                  value={docMonth}
                  onChange={(e) => setDocMonth(Number(e.target.value))}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-slate-400"
                  aria-label="Select month to view/print/download"
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i}>
                      {m}
                    </option>
                  ))}
                </select>
                <select
                  value={docYear}
                  onChange={(e) => setDocYear(Number(e.target.value))}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs font-medium text-slate-700 outline-none focus:border-slate-400"
                  aria-label="Select year to view/print/download"
                >
                  {availableYears.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
                <button
                  onClick={exportSelectedCsv}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Export CSV
                </button>
                <button
                  onClick={printSelectedDtr}
                  className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Print DTR
                </button>
                <button
                  onClick={downloadSelectedWordDtr}
                  className="col-span-2 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:col-span-1"
                >
                  Download Word
                </button>
              </div>
            )}
          </div>

          {!selectedId ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              Pick a trainee from the list to view their records.
            </p>
          ) : entriesError ? (
            <p className="px-5 py-10 text-center text-sm text-red-600">
              Couldn't load entries: {entriesError}. Check your RLS policy allows admins to select
              all dtr_entries.
            </p>
          ) : loadingEntries ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">Loading records…</p>
          ) : entries.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              No records for this trainee yet.
            </p>
          ) : visibleEntries.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">
              No records for {MONTHS[docMonth]} {docYear}.
            </p>
          ) : (
            <>
              {/* Mobile: card list */}
              <div className="divide-y divide-slate-100 sm:hidden">
                {visibleEntries.map((r) => (
                  <div key={r.id} className="px-4 py-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-900">
                        {fmtDate(r.entry_date)}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono text-xs text-slate-500">
                          {computeHours(r).toFixed(2)} hrs
                        </span>
                        <button
                          onClick={() => deleteEntry(r.id!)}
                          className="text-xs font-medium text-red-600 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-slate-600">
                      {ORDER.map((p) => (
                        <div key={p} className="flex items-center gap-1.5">
                          <span className="text-slate-400">{LABELS[p]}: </span>
                          <span className="font-mono">{fmtTime(r[p] as string | null)}</span>
                          {r[p] && (
                            <button
                              onClick={() => clearPunch(r.id!, p)}
                              title={`Clear ${LABELS[p]}`}
                              className="text-[10px] font-medium text-slate-400 hover:text-red-600"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop/tablet: table */}
              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-5 py-3 font-medium">Date</th>
                      <th className="px-5 py-3 font-medium">Check In</th>
                      <th className="px-5 py-3 font-medium">Break Out</th>
                      <th className="px-5 py-3 font-medium">Break In</th>
                      <th className="px-5 py-3 font-medium">Check Out</th>
                      <th className="px-5 py-3 text-right font-medium">Hours</th>
                      <th className="px-5 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {visibleEntries.map((r) => (
                      <tr key={r.id} className="text-slate-700">
                        <td className="px-5 py-3 font-medium text-slate-900">
                          {fmtDate(r.entry_date)}
                        </td>
                        {ORDER.map((p) => (
                          <td key={p} className="px-5 py-3 font-mono">
                            <div className="flex items-center gap-2">
                              <span>{fmtTime(r[p] as string | null)}</span>
                              {r[p] && (
                                <button
                                  onClick={() => clearPunch(r.id!, p)}
                                  title={`Clear ${LABELS[p]}`}
                                  className="text-[10px] font-medium text-slate-400 hover:text-red-600"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </td>
                        ))}
                        <td className="px-5 py-3 text-right font-mono">
                          {computeHours(r).toFixed(2)}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => deleteEntry(r.id!)}
                            className="text-xs font-medium text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </fieldset>
    </section>
  );
}
