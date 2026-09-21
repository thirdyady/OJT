import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnv } from "vite";

export function forbiddenPath(path) {
  const value = path.replaceAll("\\", "/");
  return (
    /(^|\/)\.local-test-accounts[^/]*$/i.test(value) ||
    (/(^|\/)\.env($|\.)/i.test(value) && !value.endsWith(".example")) ||
    /(^|\/)(test-results|playwright-report|\.vercel|supabase\/(\.temp|\.branches))(\/|$)/i.test(
      value,
    )
  );
}

export function containsPrivilegedKey(text) {
  if (/sb_secret_[A-Za-z0-9_-]{16,}/.test(text)) return true;
  for (const match of text.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    try {
      if (JSON.parse(Buffer.from(match[1], "base64url").toString()).role === "service_role")
        return true;
    } catch {
      /* Not a JWT. */
    }
  }
  return false;
}

export function validateProductionEnv(env) {
  const issues = [];
  for (const key of [
    "VITE_SUPABASE_URL",
    "VITE_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_URL",
    "SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    if (!env[key] || /YOUR_|replace-with/i.test(env[key]))
      issues.push(`Set ${key} in the host environment.`);
  }
  for (const key of ["VITE_SUPABASE_URL", "SUPABASE_URL", "PUBLIC_SITE_URL"]) {
    if (!env[key]) continue;
    try {
      const url = new URL(env[key]);
      if (
        url.protocol !== "https:" ||
        /^(localhost|127\.|0\.|\[::1\])/.test(url.hostname) ||
        url.username ||
        url.password
      ) {
        issues.push(`${key} must be a hosted HTTPS URL without credentials.`);
      }
    } catch {
      issues.push(`${key} is not a valid URL.`);
    }
  }
  if (env.SUPABASE_URL?.replace(/\/$/, "") !== env.VITE_SUPABASE_URL?.replace(/\/$/, ""))
    issues.push("Browser and server Supabase URLs must match.");
  for (const key of ["VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY"]) {
    if (!env[key]) continue;
    let isPublic = env[key].startsWith("sb_publishable_");
    try {
      isPublic ||=
        JSON.parse(Buffer.from(env[key].split(".")[1], "base64url").toString()).role === "anon";
    } catch {
      /* Opaque key. */
    }
    if (!isPublic) issues.push(`${key} must be a public publishable/anon key.`);
  }
  if (env.SUPABASE_SERVICE_ROLE_KEY && !containsPrivilegedKey(env.SUPABASE_SERVICE_ROLE_KEY))
    issues.push("SUPABASE_SERVICE_ROLE_KEY must be a server-only service-role/secret key.");
  for (const [key, value] of Object.entries(env)) {
    if (
      key.startsWith("VITE_") &&
      (/SECRET|SERVICE_ROLE|PASSWORD|SMTP|RESEND/i.test(key) || containsPrivilegedKey(value))
    )
      issues.push(`${key} would expose a secret to the browser.`);
  }
  return issues;
}

function filesIn(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((item) => {
    const path = join(directory, item.name);
    if (item.isSymbolicLink()) throw new Error(`Review symlink before packaging: ${path}`);
    return item.isDirectory() ? filesIn(path) : [path];
  });
}

function check() {
  const root = process.cwd();
  const failures = [];
  const env = { ...loadEnv("production", root, ""), ...process.env };
  const secrets = Object.entries(env)
    .filter(
      ([key, value]) =>
        !key.startsWith("VITE_") &&
        /SECRET|SERVICE_ROLE|PASSWORD|SMTP|RESEND/.test(key) &&
        value?.length >= 12,
    )
    .map(([, value]) => value);
  const accountsPath = join(root, ".local-test-accounts.json");
  const localEmails = [];
  if (existsSync(accountsPath)) {
    const accounts = JSON.parse(readFileSync(accountsPath, "utf8"));
    for (const account of Object.values(accounts)) {
      if (account.password) secrets.push(account.password);
      if (account.email) localEmails.push(account.email);
    }
  }

  const git = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (git.status === 0) {
    const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
      .split("\0")
      .filter(Boolean);
    for (const path of tracked) {
      if (forbiddenPath(path)) failures.push(`Local-only file is tracked/staged: ${path}`);
      // Read the index, so staging a secret then changing the working copy does
      // not hide it from the check. Never print matching lines or values.
      if (/\.(?:[cm]?[jt]sx?|json|sql|md|toml|ya?ml|env|example)$|(^|\/)\.env/.test(path)) {
        const staged = execFileSync("git", ["show", `:${path}`], {
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
        });
        if (containsPrivilegedKey(staged) || secrets.some((secret) => staged.includes(secret)))
          failures.push(`Credential detected in staged file: ${path}`);
      }
    }
  } else if (process.env.GITHUB_ACTIONS === "true") {
    failures.push("Git tracking must be available in the CI safety check.");
  } else {
    console.log(
      "Git metadata unavailable; source/artifact checks still run. CI must check the tracked files.",
    );
  }

  if (process.argv.includes("--production-env")) failures.push(...validateProductionEnv(env));
  else
    for (const [key, value] of Object.entries(env)) {
      if (
        key.startsWith("VITE_") &&
        (/SECRET|SERVICE_ROLE|PASSWORD|SMTP|RESEND/i.test(key) || containsPrivilegedKey(value))
      )
        failures.push(`Unsafe browser environment variable: ${key}`);
    }

  const artifactRoots = [".output", ".vercel/output"];
  if (process.argv.includes("--artifacts") && !artifactRoots.some((path) => existsSync(path)))
    failures.push("No production build artifacts were found.");
  const directories = process.argv.includes("--artifacts")
    ? ["public", ...artifactRoots]
    : ["public"];
  for (const directory of directories)
    for (const path of filesIn(directory)) {
      const name = relative(directory, path).replaceAll("\\", "/");
      const contents = readFileSync(path, "utf8");
      if (forbiddenPath(name) || basename(path) === "local-supabase.mjs")
        failures.push(`Local-only file in deployable files: ${path}`);
      if (
        containsPrivilegedKey(contents) ||
        [...secrets, ...localEmails].some((secret) => contents.includes(secret))
      )
        failures.push(`Credential/test-account data found in deployable files: ${path}`);
    }
  if (failures.length) throw new Error([...new Set(failures)].join("\n"));
  console.log(
    `Deployment safety checks passed${process.argv.includes("--artifacts") ? " (including build artifacts)" : ""}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    check();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
