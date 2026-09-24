import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { chiefRequestInput, chiefApprovalInput, type ChiefResponse } from "./chief-input";

export const prepareChiefAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(chiefRequestInput)
  .handler(async ({ data, context }): Promise<ChiefResponse> => {
    const role = await context.supabase.rpc("dtr_is_admin");
    if (role.error || !role.data) return { error: "Active administrator access required." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const response = await supabaseAdmin.rpc("dtr_chief_prepare", {
      actor_user_id: context.userId,
      request_id: data.requestId,
      operation: data.operation,
      payload: data.payload,
    });
    if (response.error)
      return { error: "Approval request could not be prepared. Reload and try again." };
    return response.data as ChiefResponse;
  });

export const approveChiefAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(chiefApprovalInput)
  .handler(async ({ data, context }): Promise<ChiefResponse> => {
    const role = await context.supabase.rpc("dtr_is_admin");
    if (role.error || !role.data) return { error: "Active administrator access required." };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const response = await supabaseAdmin.rpc("dtr_chief_approve", {
      actor_user_id: context.userId,
      request_id: data.requestId,
      credential: data.credential,
      new_password: data.newPassword ?? undefined,
    });
    // Never reflect database diagnostics: they can contain submitted parameters.
    if (response.error)
      return { error: "Approval response was not confirmed. Reload records before retrying." };
    return response.data as ChiefResponse;
  });
