import {
  accountProgress,
  accountLabels,
  type ProgressProfile,
  type DatedAttendance,
} from "@/lib/account-progress.mjs";

type Profile = ProgressProfile & {
  full_name: string | null;
  company: string | null;
  ojt_title: string | null;
  student_id: string | null;
};

export function AccountProfileSummary({ profile }: { profile: Profile }) {
  const values = [
    ["Account type", accountLabels[profile.account_type]],
    ["Full Name", profile.full_name],
    ...(profile.account_type === "ojt" ? [["Student ID", profile.student_id]] : []),
    [profile.account_type === "ojt" ? "Host Company" : "Office / Department", profile.company],
    [profile.account_type === "ojt" ? "OJT Title" : "Position", profile.ojt_title],
  ];
  return (
    <section
      aria-label="Account profile"
      className="rounded-xl border border-slate-200 bg-white p-4"
    >
      <h2 className="mb-3 text-sm font-semibold">Profile details</h2>
      <dl className="grid gap-3 sm:grid-cols-2">
        {values.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="text-sm">{value?.trim() || "Not provided"}</dd>
          </div>
        ))}
      </dl>
      {values.some(([, value]) => !value?.trim()) && (
        <p role="status" className="mt-3 text-sm text-amber-800">
          Some profile information is missing. Contact an administrator. Attendance records remain
          available.
        </p>
      )}
    </section>
  );
}

export function AccountProgressSummary({
  profile,
  records,
}: {
  profile: ProgressProfile;
  records: DatedAttendance[];
}) {
  const progress = accountProgress(profile, records);
  const ojt = profile.account_type === "ojt";
  const title = progress.unit
    ? `${accountLabels[profile.account_type]} progress`
    : "Attendance summary";
  const stats: [string, string][] = progress.unit
    ? [
        [
          "Required",
          progress.target === null
            ? "Not configured"
            : `${progress.target.toFixed(ojt ? 2 : 0)} ${ojt ? "hrs" : "days"}`,
        ],
        [
          ojt ? "Credited hours" : "Completed valid workdays",
          `${progress.credited?.toFixed(ojt ? 2 : 0)} ${ojt ? "hrs" : "days"}`,
        ],
        [
          "Remaining",
          progress.remaining === null
            ? "—"
            : `${progress.remaining.toFixed(ojt ? 2 : 0)} ${ojt ? "hrs" : "days"}`,
        ],
        ["Complete", progress.percentage === null ? "—" : `${progress.percentage.toFixed(1)}%`],
      ]
    : [
        ["Credited attendance hours", `${progress.hours.toFixed(2)} hrs`],
        ["Completed valid workdays", String(progress.days)],
      ];
  return (
    <section aria-label={title} className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">
        Uses this account&apos;s complete attendance history. Incomplete or invalid records receive
        no credit.
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-slate-500">{label}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {progress.percentage !== null && (
        <div
          role="progressbar"
          aria-label={`${accountLabels[profile.account_type]} completion`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(100, progress.percentage)}
          className="mt-4 h-3 overflow-hidden rounded bg-slate-100"
        >
          <div
            className="h-full bg-emerald-600"
            style={{ width: `${Math.min(100, progress.percentage)}%` }}
          />
        </div>
      )}
      {progress.unit && progress.target === null && (
        <p className="mt-3 text-sm">
          {ojt
            ? "Set your required OJT hours to start tracking your completion progress."
            : "Required workdays are not configured. Contact an administrator."}
        </p>
      )}
      {progress.percentage !== null && progress.percentage >= 100 && (
        <p className="mt-3 text-sm text-emerald-700">
          {accountLabels[profile.account_type]} target reached!
        </p>
      )}
    </section>
  );
}
