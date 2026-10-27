import {
  accountProgress,
  currentProcessingContract,
  accountLabels,
  type ProgressProfile,
  type DatedAttendance,
} from "@/lib/account-progress.mjs";

import { Check, Flag, Sparkles, Trophy } from "lucide-react";

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
      className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4"
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
  checkoutMessage,
}: {
  profile: ProgressProfile;
  records: DatedAttendance[];
  checkoutMessage?: string;
}) {
  const progress = accountProgress(profile, records);
  const ojt = profile.account_type === "ojt";
  const contract =
    profile.account_type === "processing"
      ? currentProcessingContract(profile.processing_contracts ?? [])
      : null;
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
  const percentage = progress.percentage;
  const reached = percentage !== null && percentage >= 100;
  const headline = reached
    ? "You did it. Goal reached!"
    : percentage !== null && percentage >= 90
      ? "The finish line is in sight."
      : percentage !== null && percentage >= 75
        ? "You're on the home stretch."
        : percentage !== null && percentage >= 50
          ? "Halfway there. Keep it going!"
          : percentage !== null && percentage >= 25
            ? "Look how far you've come."
            : "Every completed day moves you forward.";
  if (progress.unit) {
    const Icon = reached ? Trophy : Flag;
    return (
      <section
        aria-label={title}
        className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
      >
        <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-blue-900 p-5 text-white sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-widest text-blue-200">
                {title}
              </h2>
              <p className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">{headline}</p>
              <p className="mt-2 text-sm text-blue-100">
                {reached
                  ? "Your effort has added up. Take a moment to enjoy this milestone."
                  : progress.remaining !== null
                    ? `${progress.remaining.toFixed(ojt ? 2 : 0)} ${ojt ? "hours" : "workdays"} to your goal. One day at a time.`
                    : "Your completed attendance counts. Set a target to see your journey."}
              </p>
            </div>
            <span className="shrink-0 rounded-2xl border border-white/20 bg-white/10 p-3 text-amber-300">
              <Icon aria-hidden="true" className="h-6 w-6" />
            </span>
          </div>
          {percentage !== null && (
            <div className="mt-6">
              <div className="mb-2 flex items-end justify-between gap-3">
                <span className="text-sm text-blue-100">Your journey</span>
                <span className="text-3xl font-semibold tabular-nums">
                  {percentage.toFixed(1)}
                  <span className="ml-1 text-sm text-blue-200">%</span>
                </span>
              </div>
              <div
                role="progressbar"
                aria-label={`${accountLabels[profile.account_type]} completion`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.min(100, percentage)}
                className="h-3 overflow-hidden rounded-full bg-white/15"
              >
                <div
                  className="h-full rounded-full bg-gradient-to-r from-sky-300 to-emerald-300 transition-[width] duration-1000 ease-out motion-reduce:transition-none"
                  style={{ width: `${Math.min(100, percentage)}%` }}
                />
              </div>
              <ol aria-label="Progress milestones" className="mt-4 grid grid-cols-4 gap-2">
                {[25, 50, 75, 100].map((milestone) => (
                  <li
                    key={milestone}
                    className={`flex flex-col items-center gap-1 text-xs ${percentage >= milestone ? "text-emerald-200" : "text-blue-200"}`}
                  >
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full border ${percentage >= milestone ? "border-emerald-300 bg-emerald-300 text-blue-950" : "border-blue-300/40"}`}
                    >
                      {percentage >= milestone ? (
                        <Check aria-hidden="true" className="h-4 w-4" />
                      ) : (
                        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-blue-200" />
                      )}
                    </span>
                    <span>
                      {milestone}%
                      <span className="sr-only">
                        {percentage >= milestone ? " reached" : " ahead"}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
        <div className="p-5 sm:p-6">
          <div role="status" aria-live="polite" aria-atomic="true">
            {checkoutMessage && (
              <p className="mb-5 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-900">
                <Sparkles aria-hidden="true" className="h-5 w-5 shrink-0" />
                {checkoutMessage}
              </p>
            )}
          </div>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {stats.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-slate-500">{label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            {ojt
              ? "Uses this account's complete attendance history."
              : contract
                ? `Contract: ${contract.start_date === "0001-01-01" ? "Existing history" : contract.start_date} to ${contract.end_date ?? "renewal"}.`
                : "No started contract is configured."}{" "}
            Incomplete or invalid records receive no credit.
          </p>
          {progress.target === null && (
            <p className="mt-3 text-sm text-slate-700">
              {ojt
                ? "Set your required OJT hours to start tracking your completion progress."
                : "Required workdays are not configured. Contact an administrator."}
            </p>
          )}
          {reached && (
            <p className="mt-3 text-sm font-medium text-emerald-700">
              {accountLabels[profile.account_type]} target reached!
            </p>
          )}
        </div>
      </section>
    );
  }
  return (
    <section
      aria-label={title}
      className="rounded-2xl border border-slate-200 bg-white shadow-sm p-4"
    >
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
    </section>
  );
}
