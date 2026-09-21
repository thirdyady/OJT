import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const traineeAccountInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(8).max(72),
  fullName: z.string().trim().min(1).max(200),
  studentId: z.string().trim().min(1).max(100),
  company: z.string().trim().min(1).max(200),
  ojtTitle: z.string().trim().min(1).max(200),
  requiredOjtHours: z.number().finite().positive().max(10000).nullable(),
});

export type CreateTraineeAccountInput = z.infer<typeof traineeAccountInput>;

export type CreatedTraineeProfile = {
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
  .validator(traineeAccountInput)
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

export const deleteUnusedTraineeAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(z.object({ targetUserId: z.string().uuid(), confirmation: z.string().uuid() }))
  .handler(async ({ data, context }): Promise<{ deletedId: string }> => {
    const { data: isAdmin, error: roleError } = await context.supabase.rpc("dtr_is_admin");
    if (roleError || !isAdmin) {
      throw new Error("Only active DTR administrators can delete trainee accounts.");
    }
    if (context.userId === data.targetUserId) {
      throw new Error("You cannot delete your own account.");
    }
    if (data.confirmation !== data.targetUserId) {
      throw new Error("Type the exact account ID to confirm deletion.");
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: deletedId, error } = await supabaseAdmin.rpc("dtr_delete_unused_trainee", {
      actor_user_id: context.userId,
      target_user_id: data.targetUserId,
      confirmation: data.confirmation,
    });
    if (error) throw new Error(`Deletion was not confirmed. ${error.message}`);
    if (deletedId !== data.targetUserId) {
      throw new Error("Deletion was not confirmed. Refresh the account list before retrying.");
    }
    return { deletedId };
  });
