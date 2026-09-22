import { z } from "zod";

// Shared by the form and trusted provisioning boundary. No privileged imports.
export const accountInput = z
  .object({
    accountType: z.enum(["ojt", "job_order", "processing", "regular_employee"]).default("ojt"),
    email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
    password: z.string().min(8, "Temporary password must contain at least 8 characters.").max(72),
    fullName: z.string().trim().min(1, "Full name is required.").max(200),
    studentId: z.string().trim().max(100).nullable().default(null),
    company: z.string().trim().min(1, "Company or office is required.").max(200),
    ojtTitle: z.string().trim().min(1, "Position or OJT title is required.").max(200),
    requiredOjtHours: z.number().finite().positive().max(10000).nullable().default(null),
    requiredWorkdays: z.number().int().positive().max(2147483647).nullable().default(null),
  })
  .strict()
  .superRefine((data, ctx) => {
    const reject = (path: string, message: string) =>
      ctx.addIssue({ code: "custom", path: [path], message });
    if (data.accountType === "ojt") {
      if (!data.studentId) reject("studentId", "Student ID is required for OJT accounts.");
    } else {
      if (data.studentId !== null)
        reject("studentId", "Student ID is only applicable to OJT accounts.");
      if (data.requiredOjtHours !== null)
        reject("requiredOjtHours", "Only OJT accounts have an hour target.");
    }
    if (data.accountType === "processing") {
      if (data.requiredWorkdays === null)
        reject("requiredWorkdays", "Processing requires a positive whole-day target.");
    } else if (data.requiredWorkdays !== null) {
      reject("requiredWorkdays", "Only Processing accounts have a day target.");
    }
  });

export type AccountInput = z.infer<typeof accountInput>;
