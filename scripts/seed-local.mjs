import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { localSupabase, checked } from "./local-supabase.mjs";

const { admin, url, publicKey } = localSupabase();
const credentialsPath = ".local-test-accounts.json";
const previous = existsSync(credentialsPath)
  ? JSON.parse(readFileSync(credentialsPath, "utf8"))
  : {};
const accounts = {};
const { users } = checked(await admin.auth.admin.listUsers({ perPage: 1000 }));
for (const [role, email, name] of [
  ["admin", "admin@ojt.local.test", "Local Test Administrator"],
  ["trainee", "trainee@ojt.local.test", "Local Test Trainee"],
  ["other", "other@ojt.local.test", "Other Test Trainee"],
]) {
  const password = previous[role]?.password || `Ojt!${randomBytes(18).toString("base64url")}`;
  const existing = users.find((user) => user.email === email);
  const { user } = checked(
    existing
      ? await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true })
      : await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: name },
        }),
  );
  accounts[role] = { email, password, id: user.id };
  checked(
    await admin.from("profiles").upsert({
      id: user.id,
      full_name: name,
      student_id: role === "admin" ? null : `TEST-${role}`,
      company: "PSA (local test)",
      ojt_title:
        role === "admin"
          ? "DTR Administrator"
          : role === "trainee"
            ? "Software Development Intern"
            : "Data Processing Intern",
      required_ojt_hours: role === "admin" ? null : 486,
      is_admin: role === "admin",
    }),
  );
  if (role !== "admin") {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    checked(
      await admin.from("dtr_entries").upsert(
        {
          user_id: user.id,
          entry_date: key,
          check_in: `${key}T08:00:00+08:00`,
          break_out: `${key}T12:00:00+08:00`,
          break_in: `${key}T13:00:00+08:00`,
          check_out: `${key}T17:00:00+08:00`,
        },
        { onConflict: "user_id,entry_date", ignoreDuplicates: true },
      ),
    );
  }
}
writeFileSync(credentialsPath, JSON.stringify(accounts, null, 2) + "\n");
// Development-mode override only: production builds still use the original env.
writeFileSync(
  ".env.development.local",
  `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_PUBLISHABLE_KEY=${publicKey}\n`,
);
console.log(
  "Local admin and two trainee accounts are ready. Credentials: .local-test-accounts.json",
);
console.log("Local-only development configuration saved. Start with npm run dev.");
