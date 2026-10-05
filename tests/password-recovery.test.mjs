import { test } from "node:test";
import assert from "node:assert/strict";
import {
  recoveryWaitSeconds,
  startRecoveryCooldown,
  RECOVERY_COOLDOWN_KEY,
} from "../src/lib/password-recovery.ts";
import { getAppOrigin, getPasswordRecoveryRedirectUrl } from "../src/lib/auth-urls.ts";
test("recovery cooldown stores only a deadline, expires, and survives storage failures", () => {
  const saved = new Map();
  globalThis.window = {
    localStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
  };
  try {
    assert.equal(recoveryWaitSeconds(100000), 0);
    startRecoveryCooldown(100000);
    assert.equal(recoveryWaitSeconds(100000), 60);
    assert.equal(saved.get(RECOVERY_COOLDOWN_KEY), "160000");
    assert.equal(saved.size, 1);
    assert.equal(recoveryWaitSeconds(161000), 0);
    saved.set(RECOVERY_COOLDOWN_KEY, "not-a-date");
    assert.equal(recoveryWaitSeconds(200000), 0);
    saved.set(RECOVERY_COOLDOWN_KEY, "999999999999999");
    assert.equal(recoveryWaitSeconds(200000), 0);
    window.localStorage = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("blocked");
      },
    };
    startRecoveryCooldown(300000);
    assert.equal(recoveryWaitSeconds(300000), 60);
    assert.equal(recoveryWaitSeconds(360000), 0);
  } finally {
    delete globalThis.window;
  }
});
test("redirect helpers use serving origin, ignore URL-supplied destinations, and constrain server fallback", () => {
  const original = process.env.PUBLIC_SITE_URL;
  try {
    for (const origin of ["http://localhost:3000", "https://approved.example.invalid"]) {
      globalThis.window = {
        location: {
          origin,
          search: "?redirect_to=https://unapproved.invalid",
          hash: "#next=https://unapproved.invalid",
        },
      };
      assert.equal(getPasswordRecoveryRedirectUrl(), `${origin}/reset-password?flow=recovery`);
    }
    delete globalThis.window;
    process.env.PUBLIC_SITE_URL = "https://approved.example.invalid";
    assert.equal(getAppOrigin(), "https://approved.example.invalid");
    for (const value of ["javascript:alert(1)", "http://unapproved.invalid", "not a URL"]) {
      process.env.PUBLIC_SITE_URL = value;
      assert.equal(getAppOrigin(), "http://localhost:3000");
    }
  } finally {
    delete globalThis.window;
    if (original === undefined) delete process.env.PUBLIC_SITE_URL;
    else process.env.PUBLIC_SITE_URL = original;
  }
});
