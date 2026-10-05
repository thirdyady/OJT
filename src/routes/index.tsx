import { createFileRoute, Link } from "@tanstack/react-router";
import psaLogo from "../../assets/psa-logo.webp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "PSA · Daily Time Record" },
      {
        name: "description",
        content: "Philippine Statistics Authority attendance and daily time records.",
      },
    ],
  }),
  component: LandingPage,
});
function LandingPage() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-6">
        <img
          src={psaLogo}
          alt="Philippine Statistics Authority"
          className="h-16 w-16 object-contain"
        />
        <div>
          <p className="font-semibold text-blue-950">Philippine Statistics Authority</p>
          <p className="text-sm text-slate-600">Daily Time Record System</p>
        </div>
      </header>
      <section
        className="mx-auto grid max-w-6xl items-center gap-10 px-6 py-12 md:grid-cols-2 md:py-20"
        aria-labelledby="landing-title"
      >
        <div>
          <p className="mb-4 text-sm font-semibold uppercase tracking-widest text-blue-800">
            PSA Attendance
          </p>
          <h1
            id="landing-title"
            className="text-4xl font-bold leading-tight text-blue-950 sm:text-5xl"
          >
            Your workday, recorded clearly.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-700">
            Record attendance, review your daily time records, and keep track of your work at the
            Philippine Statistics Authority.
          </p>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            For OJT, Job Order, Processing, and Regular Employee accounts. Sign in with your
            assigned account to get started.
          </p>
          <Link
            to="/auth"
            className="mt-8 inline-flex min-h-12 items-center justify-center rounded-lg bg-blue-900 px-7 py-3 font-semibold text-white hover:bg-blue-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-900"
          >
            Sign in
          </Link>
        </div>
        <div
          className="flex flex-col items-center rounded-2xl border border-blue-100 bg-white px-8 py-10 shadow-sm"
          aria-hidden="true"
        >
          <img src={psaLogo} alt="" className="aspect-square w-full max-w-72 object-contain" />
          <p className="mt-6 text-center text-sm font-semibold tracking-wide text-blue-950">
            DAILY TIME RECORD
          </p>
        </div>
      </section>
      <section
        aria-label="Attendance services"
        className="mx-auto grid max-w-6xl gap-6 px-6 pb-16 sm:grid-cols-3"
      >
        {[
          ["Daily attendance", "Record your attendance and review saved punches."],
          ["Clear records", "Review your monthly DTR and download attendance records."],
          [
            "Account support",
            "Contact your administrator for account assistance or attendance corrections.",
          ],
        ].map(([title, text]) => (
          <article key={title} className="rounded-xl border border-slate-200 bg-white p-6">
            <h2 className="font-semibold text-blue-950">{title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{text}</p>
          </article>
        ))}
      </section>
      <footer className="border-t border-slate-200 px-6 py-6 text-center text-sm text-slate-600">
        Philippine Statistics Authority · Daily Time Record
      </footer>
    </main>
  );
}
