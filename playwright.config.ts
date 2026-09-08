import { defineConfig } from "@playwright/test";
import { localSupabase } from "./scripts/local-supabase.mjs";

const { url, publicKey } = localSupabase();

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    channel: "msedge",
    timezoneId: "Asia/Manila",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --strictPort",
    url: "http://localhost:3000",
    reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: publicKey },
  },
});
