import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase, getPasswordRecoverySession } from "@/integrations/supabase/client";
import { useRecoveryRedirect } from "@/hooks/use-recovery-redirect";

function AuthenticatedLayout() {
  useRecoveryRedirect();
  return <Outlet />;
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    if (getPasswordRecoverySession(sessionData.session))
      throw redirect({ to: "/reset-password", search: { flow: "recovery" } });
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
});
