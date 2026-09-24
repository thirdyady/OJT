import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Enums } from "@/integrations/supabase/types";
import { accountInput, type AccountInput } from "./account-input";

export type CreateTraineeAccountInput = AccountInput;

export type CreatedTraineeProfile = {
  account_type: Enums<"account_type">;
  required_workdays: number | null;
  updated_at: string;
  id: string;
  full_name: string | null;
  student_id: string | null;
  company: string | null;
  ojt_title: string | null;
  required_ojt_hours: number | null;
  is_admin: boolean;
  is_active: boolean;
};

export const createTraineeAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(accountInput)
  .handler(async ({ data, context }): Promise<{ profile: CreatedTraineeProfile }> => {
    const { data: isAdmin, error: roleError } = await context.supabase.rpc("dtr_is_admin");
    if (roleError) {
      throw new Error("Administrator access could not be verified.");
    }
    if (!isAdmin) {
      throw new Error("Only DTR administrators can create trainee accounts.");
    }

    // This module is loaded only inside the server handler. The service-role
    // key is read from the server environment and never crosses this boundary.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { provisionTrainee } = await import("@/lib/provision-trainee.server");
    return provisionTrainee(supabaseAdmin, data);
  });
