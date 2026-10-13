import { CalendarDays } from "lucide-react";

export function AttendanceLoading({ label = "Loading attendance…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="rounded-2xl border border-slate-200 bg-white p-5"
    >
      <p className="text-sm font-medium text-slate-600">{label}</p>
      <div aria-hidden="true" className="mt-4 space-y-3 motion-safe:animate-pulse">
        <div className="h-3 w-1/3 rounded-full bg-slate-200" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <div key={item} className="h-16 rounded-xl bg-slate-100" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function AttendanceEmpty({ title, description }: { title: string; description: string }) {
  return (
    <div className="px-5 py-10 text-center">
      <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-blue-800">
        <CalendarDays aria-hidden="true" className="h-5 w-5" />
      </span>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-slate-500">{description}</p>
    </div>
  );
}
