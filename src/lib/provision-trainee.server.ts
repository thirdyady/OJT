import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../integrations/supabase/types";
import type { CreateTraineeAccountInput, CreatedTraineeProfile } from "./admin-account.functions";
import { accountInput } from "./account-input.ts";

// Called only after the server endpoint verifies the active administrator.
export async function provisionTrainee(
  supabaseAdmin: SupabaseClient<Database>,
  input: CreateTraineeAccountInput,
): Promise<{ profile: CreatedTraineeProfile }> {
  // Validate before allocating an Auth ID, even when called outside the endpoint.
  const data = accountInput.parse(input);
  const { data: created, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    // Auth app_metadata is writable only through trusted admin operations.
    // The signup trigger never trusts account type in user_metadata.
    app_metadata: {
      dtr_account_type: data.accountType,
      dtr_required_workdays: data.requiredWorkdays,
      dtr_required_ojt_hours: data.requiredOjtHours,
    },
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
        account_type: data.accountType,
        required_workdays: data.requiredWorkdays,
        full_name: data.fullName,
        student_id: data.studentId,
        company: data.company,
        ojt_title: data.ojtTitle,
        required_ojt_hours: data.requiredOjtHours,
        is_admin: false,
        is_active: true,
      })
      .select(
        "id, full_name, student_id, company, ojt_title, account_type, required_ojt_hours, required_workdays, is_admin, is_active, updated_at",
      )
      .single();

    if (profileError || !profile) {
      throw new Error(profileError?.message ?? "The trainee profile was not returned.");
    }

    return { profile: profile as CreatedTraineeProfile };
  } catch (profileError) {
    try {
      const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(created.user.id);
      if (rollbackError) throw rollbackError;
    } catch {
      throw new Error(
        "Account setup failed, and automatic cleanup also failed. Contact an administrator before retrying.",
      );
    }
    throw new Error(
      `Account setup failed. The temporary authentication account was rolled back. ${profileError instanceof Error ? profileError.message : "Please try again."}`,
    );
  }
}
