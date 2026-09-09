import { spawn } from "node:child_process";
import { localSupabase } from "./local-supabase.mjs";

const { url, publicKey, serviceRoleKey } = localSupabase();
const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : "npm";
const args =
  process.platform === "win32"
    ? ["/d", "/s", "/c", "npm run dev -- --strictPort"]
    : ["run", "dev", "--", "--strictPort"];
const child = spawn(command, args, {
  stdio: "inherit",
  env: {
    ...process.env,
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: publicKey,
    SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey,
    VITE_SUPABASE_URL: url,
    VITE_SUPABASE_PUBLISHABLE_KEY: publicKey,
  },
});

const forwardSignal = (signal) => child.kill(signal);
process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
