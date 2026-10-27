import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { networkInterfaces } from "node:os";

const lan = process.argv.includes("--lan");

// Explicit opt-in to the NEW hosted test project. Never resolves the old .env target.
const project = "ojaffohibrltrzrbjcsd";
const root = fileURLToPath(new URL("../", import.meta.url));
const windows = process.platform === "win32";
const command = windows ? process.env.ComSpec || "cmd.exe" : "npx";
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
const result = spawnSync(command, windows ? ["/d", "/s", "/c", "npx", ...args] : args, {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});
let keys;
try {
  if (result.status !== 0) throw new Error();
  keys = JSON.parse(result.stdout);
} catch {
  throw new Error(
    "Cannot access the new hosted project. Run supabase login with its owner account. Credential output was withheld.",
  );
}
const publicKey =
  keys.find((key) => key.name === "anon")?.api_key ||
  keys.find((key) => key.type === "publishable")?.api_key;
const serverKey =
  keys.find((key) => key.name === "service_role")?.api_key ||
  keys.find((key) => key.type === "secret")?.api_key;
if (!publicKey || !serverKey) throw new Error("Project credentials are unavailable.");
const url = `https://${project}.supabase.co`;
console.log(`HOSTED TEST DATABASE: ${project}. Actions here change the NEW hosted database.`);
console.log("Open http://localhost:3001. Use npm run local:dev for isolated local testing.");
if (lan) {
  console.log("LAN testing enabled. Keep this development server on a trusted network.");
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        console.log(`Network address: http://${address.address}:3001`);
      }
    }
  }
  console.log(
    "Use HTTPS staging for full recovery/Chief testing; HTTP LAN is not a secure browser context.",
  );
}
const child = spawn(
  process.execPath,
  [
    "node_modules/vite/bin/vite.js",
    "dev",
    "--host",
    lan ? "0.0.0.0" : "localhost",
    "--port",
    "3001",
    "--strictPort",
  ],
  {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      SUPABASE_PROJECT_ID: project,
      VITE_SUPABASE_PROJECT_ID: project,
      SUPABASE_URL: url,
      SUPABASE_PUBLISHABLE_KEY: publicKey,
      SUPABASE_SERVICE_ROLE_KEY: serverKey,
      VITE_SUPABASE_URL: url,
      VITE_SUPABASE_PUBLISHABLE_KEY: publicKey,
      PUBLIC_SITE_URL: "http://localhost:3001",
    },
  },
);
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
child.on("error", () => {
  console.error("Could not start the hosted test server.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
