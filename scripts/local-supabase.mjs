import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

export function localSupabase() {
  // Fixed CLI command; never read hosted credentials from .env.
  const command = process.platform === "win32" ? "cmd.exe" : "npx";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npx --yes supabase status -o json"]
      : ["--yes", "supabase", "status", "-o", "json"];
  const status = JSON.parse(
    execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
  );
  const url = new URL(status.API_URL);
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Refusing to seed or test a non-local Supabase database.");
  }
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    url: status.API_URL,
    publicKey: status.ANON_KEY || status.PUBLISHABLE_KEY,
    serviceRoleKey: status.SERVICE_ROLE_KEY || status.SECRET_KEY,
    admin: createClient(status.API_URL, status.SERVICE_ROLE_KEY || status.SECRET_KEY, options),
    client: () => createClient(status.API_URL, status.ANON_KEY || status.PUBLISHABLE_KEY, options),
  };
}

export function checked(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
