import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    throw redirect({ to: data.session ? "/dashboard" : "/auth" });
  },
  component: LandingPage,
});

function LandingPage() {
  const navigate = useNavigate();

  useEffect(() => {
    let mounted = true;

    const routeToEntryPoint = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (mounted) await navigate({ to: data.session ? "/dashboard" : "/auth", replace: true });
      } catch {
        // A broken or unavailable auth session should still leave the user at
        // the sign-in screen instead of leaving a blank page.
        if (mounted) await navigate({ to: "/auth", replace: true });
      }
    };

    void routeToEntryPoint();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <p role="status" aria-live="polite" className="text-sm text-slate-500">
        Loading OJT DTR…
      </p>
    </main>
  );
}
