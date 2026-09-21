import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";
import type { CreateTraineeAccountInput, CreatedTraineeProfile } from "./admin-account.functions";

// Called only after the server endpoint verifies the active administrator.
export async function provisionTrainee(
  supabaseAdmin: SupabaseClient<Database>,
  data: CreateTraineeAccountInput,
): Promise<{ profile: CreatedTraineeProfile }> {
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
        "id, full_name, student_id, company, ojt_title, required_ojt_hours, is_admin, is_active, updated_at",
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
}
