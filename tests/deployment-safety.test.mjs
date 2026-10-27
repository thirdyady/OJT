import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  forbiddenPath,
  containsPrivilegedKey,
  containsKnownSecret,
  validateProductionEnv,
} from "../scripts/check-deployment.mjs";

const jwt = (role) =>
  `${Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.signature`;
const valid = {
  VITE_SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_URL: "https://project.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY: jwt("anon"),
  SUPABASE_PUBLISHABLE_KEY: jwt("anon"),
  SUPABASE_SERVICE_ROLE_KEY: jwt("service_role"),
};

test("short numeric credentials are detected without matching part of a longer digit sequence", () => {
  const secret = "3456789";
  for (const text of [`password='${secret}'`, `prefix${secret}suffix`, `{"password":"${secret}"}`])
    assert.equal(containsKnownSecret(text, secret), true);
  assert.equal(containsKnownSecret("abcdef0123456789abcdef0123456789", secret), false);
  assert.equal(containsKnownSecret("prefix-Test-password-suffix", "Test-password"), true);
  assert.equal(containsKnownSecret("prefix0123456789012345suffix", "123456789012"), true);
});

test("the executable guard rejects force-staged account files and copies in public output", () => {
  const temporaryRoot = resolve(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, "dtr-deployment-check-"));
  try {
    execFileSync("git", ["init", "--quiet", directory]);
    const account = ".local-test-accounts.json";
    writeFileSync(join(directory, account), "{}");
    execFileSync("git", ["-C", directory, "add", "-f", account]);
    mkdirSync(join(directory, "public"));
    writeFileSync(join(directory, "public", account), "{}");
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../scripts/check-deployment.mjs", import.meta.url))],
      { cwd: directory, encoding: "utf8" },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Local-only file is tracked\/staged/);
    assert.match(result.stderr, /Local-only file in deployable files/);
  } finally {
    // Only the temporary fixture directory created above is removed.
    assert.equal(dirname(resolve(directory)), temporaryRoot);
    assert.ok(basename(directory).startsWith("dtr-deployment-check-"));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("local account copies, env files, and test artifacts are forbidden; templates remain trackable", () => {
  for (const path of [
    ".local-test-accounts.json",
    "public/.local-test-accounts.json.bak",
    "backup/.env.production",
    "supabase/.temp/cli-latest",
    "test-results/trace.zip",
    ".vercel/project.json",
  ])
    assert.equal(forbiddenPath(path), true, path);
  for (const path of [
    ".env.production.example",
    ".env.development.local.example",
    "supabase/migrations/20260921000000_attendance_integrity.sql",
  ])
    assert.equal(forbiddenPath(path), false, path);
});

test("executable guard checks new source, modified working files and the index independently", () => {
  const temporaryRoot = resolve(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, "dtr-deployment-check-"));
  const run = () =>
    spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../scripts/check-deployment.mjs", import.meta.url))],
      { cwd: directory, encoding: "utf8" },
    );
  try {
    execFileSync("git", ["init", "--quiet", directory]);
    writeFileSync(join(directory, ".gitignore"), ".local-test-accounts.json\n");
    const password = "local-fixture-" + "credential";
    writeFileSync(
      join(directory, ".local-test-accounts.json"),
      JSON.stringify({ test: { password } }),
    );
    writeFileSync(join(directory, "source.ts"), "export const safe = true;");
    assert.equal(run().status, 0);
    writeFileSync(join(directory, "source.ts"), `export const password = '${password}';`);
    assert.match(run().stderr, /Credential detected in working file/);
    execFileSync("git", ["-C", directory, "add", "source.ts"]);
    writeFileSync(join(directory, "source.ts"), "export const safe = true;");
    assert.match(run().stderr, /Credential detected in staged file/);
    execFileSync("git", ["-C", directory, "add", "source.ts"]);
    writeFileSync(join(directory, "source.ts"), `export const password = '${password}';`);
    assert.match(run().stderr, /Credential detected in working file/);
  } finally {
    assert.equal(dirname(resolve(directory)), temporaryRoot);
    assert.ok(basename(directory).startsWith("dtr-deployment-check-"));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("privileged keys are identified without confusing public keys or code references", () => {
  assert.equal(containsPrivilegedKey(jwt("service_role")), true);
  assert.equal(containsPrivilegedKey("sb_secret_" + "x".repeat(24)), true);
  assert.equal(containsPrivilegedKey(jwt("anon")), false);
  assert.equal(containsPrivilegedKey("process.env.SUPABASE_SERVICE_ROLE_KEY"), false);
});

test("production environment rejects missing, localhost, mismatched and browser-secret configurations", () => {
  assert.deepEqual(validateProductionEnv(valid), []);
  assert.ok(validateProductionEnv({}).length);
  assert.ok(validateProductionEnv({ ...valid, SUPABASE_URL: "http://127.0.0.1:54321" }).length);
  assert.ok(
    validateProductionEnv({ ...valid, VITE_SUPABASE_URL: "https://other.supabase.co" }).length,
  );
  assert.ok(
    validateProductionEnv({ ...valid, VITE_SUPABASE_PUBLISHABLE_KEY: jwt("service_role") }).length,
  );
  assert.ok(validateProductionEnv({ ...valid, VITE_SMTP_PASSWORD: "password" }).length);
  assert.ok(validateProductionEnv({ ...valid, SUPABASE_SERVICE_ROLE_KEY: jwt("anon") }).length);
});
