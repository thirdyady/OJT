import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { getPasswordRecoverySession, supabase } from "@/integrations/supabase/client";

// Keep already-mounted pages in the recovery flow when another tab opens a link.
// This is a navigation guard; Supabase and RLS remain the authorization boundary.
export function useRecoveryRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    let active = true;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (active && getPasswordRecoverySession(data.session))
        void navigate({ to: "/reset-password", search: { flow: "recovery" }, replace: true });
    };
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(() => {
      void check();
    });
    // The marker can reach another tab after the Supabase auth event.
    window.addEventListener("storage", check);
    void check();
    return () => {
      active = false;
      subscription.unsubscribe();
      window.removeEventListener("storage", check);
    };
  }, [navigate]);
}
