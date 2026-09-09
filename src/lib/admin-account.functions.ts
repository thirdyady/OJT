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
    const { data: created, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        full_name: data.fullName,
        student_id: data.studentId,
        company: data.company,
        ojt_title: data.ojtTitle,
      },
    });

    if (authError || !created.user) {
      throw new Error(`Account was not created. ${authError?.message ?? "No user was returned."}`);
    }

    try {
      const { data: profile, error: profileError } = await supabaseAdmin
        .from("profiles")
        .upsert({
          id: created.user.id,
          full_name: data.fullName,
          student_id: data.studentId,
          company: data.company,
          ojt_title: data.ojtTitle,
          required_ojt_hours: data.requiredOjtHours,
          is_admin: false,
          is_active: true,
        })
        .select(
          "id, full_name, student_id, company, ojt_title, required_ojt_hours, is_admin, is_active",
        )
        .single();

      if (profileError || !profile) {
        throw new Error(profileError?.message ?? "The trainee profile was not returned.");
      }

      return { profile: profile as CreatedTraineeProfile };
    } catch (profileError) {
      const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      if (rollbackError) {
        throw new Error(
          `Account setup failed, and automatic cleanup also failed. Contact an administrator. (${rollbackError.message})`,
        );
      }
      throw new Error(
        `Account setup failed. The temporary authentication account was rolled back. ${profileError instanceof Error ? profileError.message : "Please try again."}`,
      );
    }
  });
