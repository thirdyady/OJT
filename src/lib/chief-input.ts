import { z } from "zod";
const stamp = z.string().datetime({ offset: true }).nullable();
export const punchValues = z
  .object({ check_in: stamp, break_out: stamp, break_in: stamp, check_out: stamp })
  .strict();
const targetUserId = z.string().uuid();
export const chiefRequestInput = z.discriminatedUnion("operation", [
  z
    .object({
      requestId: z.string().uuid(),
      operation: z.literal("edit_dtr"),
      payload: z
        .object({
          targetUserId,
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          expected: punchValues.extend({ id: z.string().uuid() }).nullable(),
          values: punchValues,
          reason: z.string().trim().min(3).max(1000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      requestId: z.string().uuid(),
      operation: z.literal("delete_account"),
      payload: z.object({ targetUserId, confirmation: z.string().uuid() }).strict(),
    })
    .strict(),
  z
    .object({
      requestId: z.string().uuid(),
      operation: z.enum(["change_ssp", "recover_ssp"]),
      payload: z.object({}).strict(),
    })
    .strict(),
]);
export const chiefApprovalInput = z
  .object({
    requestId: z.string().uuid(),
    credential: z.string().min(1).max(72),
    newPassword: z.string().min(12).max(72).optional(),
    confirmPassword: z.string().max(72).optional(),
  })
  .strict()
  .refine((v) => v.newPassword === v.confirmPassword, "New passwords must match.");
export type ChiefRequest = z.infer<typeof chiefRequestInput>;
export type PunchValues = z.infer<typeof punchValues>;
export type ChiefResponse = {
  error?: string;
  ok?: boolean;
  requestId?: string;
  expiresAt?: string;
  deletedId?: string;
  recoveryCode?: string;
  account?: { id: string; name: string; email: string; account_type: string; position: string };
};
