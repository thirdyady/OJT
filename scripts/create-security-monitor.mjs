import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { localSupabase } from "./local-supabase.mjs";

// Explicit destination required. Never infer a hosted target from .env.
const target = process.argv[2];
const project = "ojaffohibrltrzrbjcsd";
let admin, client;
if (target === "--local") {
  const local = localSupabase();
  admin = local.admin;
  client = local.client();
} else if (target === "--new-hosted") {
  const command = process.platform === "win32" ? "cmd.exe" : "npx";
  const args = [
    "--yes",
    "supabase",
    "projects",
    "api-keys",
    "--project-ref",
    project,
    "--reveal",
    "--output",
    "json",
  ];
  let keys;
  try {
    keys = JSON.parse(
      execFileSync(
        command,
        process.platform === "win32" ? ["/d", "/s", "/c", "npx", ...args] : args,
        { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      ),
    );
  } catch {
    throw new Error("Cannot access the new hosted project. Credential output withheld.");
  }
  const serverKey =
    keys.find((k) => k.name === "service_role")?.api_key ||
    keys.find((k) => k.type === "secret")?.api_key;
  const publicKey =
    keys.find((k) => k.name === "anon")?.api_key ||
    keys.find((k) => k.type === "publishable")?.api_key;
  if (!serverKey || !publicKey) throw new Error("Required project credentials unavailable.");
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  admin = createClient(`https://${project}.supabase.co`, serverKey, options);
  client = createClient(`https://${project}.supabase.co`, publicKey, options);
} else throw new Error("Choose --local or --new-hosted explicitly.");

// The Auth trigger creates the private monitor row in the same transaction.
// Existing accounts are never reset or converted by this script.
const email = "psasecurity@security.psa-dtr.invalid";
const password = `Guard-${randomBytes(9).toString("base64url")}!`;
const result = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  app_metadata: { dtr_access_role: "security_monitor" },
});
if (result.error) throw new Error(`Account creation failed: ${result.error.message}`);
const login = await client.auth.signInWithPassword({ email, password });
if (login.error)
  throw new Error("Created account could not sign in. Do not rerun creation; inspect Auth first.");
const role = await client.rpc("dtr_is_security_monitor");
if (role.error || role.data !== true)
  throw new Error(
    "Monitor migration is missing or access verification failed. Account was not verified.",
  );
const profile = await admin.from("profiles").select("id").eq("id", result.data.user.id);
if (profile.error || profile.data.length)
  throw new Error("Unexpected employee profile. Stop and investigate.");
await client.auth.signOut();
console.log(`Verified security monitor on ${target === "--local" ? "local database" : project}.`);
console.log("Username: psasecurity");
// Intended one-time handover output. Never persist this password to source or .env.
console.log(`Temporary password: ${password}`);
