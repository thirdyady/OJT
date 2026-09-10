const LOCAL_ORIGIN = "http://localhost:3000";

/**
 * Return the origin that should receive Supabase Auth redirects.
 *
 * Browser redirects use the origin currently serving the app. This keeps local,
 * preview, and production deployments on their own host without putting a
 * secret or a user-provided URL into the redirect. Server-side callers use the
 * optional public URL when one is configured and otherwise fall back to local.
 */
export function getAppOrigin(): string {
  if (typeof window !== "undefined" && window.location.origin) {
    return window.location.origin;
  }

  const configuredOrigin =
    typeof process !== "undefined" ? process.env.PUBLIC_SITE_URL?.trim() : undefined;
  if (configuredOrigin) {
    try {
      const url = new URL(configuredOrigin);
      if (url.protocol === "https:" || (url.protocol === "http:" && isLocalHost(url.hostname))) {
        return url.origin;
      }
    } catch {
      // Use the safe local fallback when a public URL is malformed.
    }
  }

  return LOCAL_ORIGIN;
}

export function getPasswordRecoveryRedirectUrl(): string {
  // Supabase removes the one-time access-token hash after processing it. Keep
  // this marker in the query string so the page can distinguish recovery from
  // a regular signed-in password change.
  return `${getAppOrigin()}/reset-password?flow=recovery`;
}

export function getEmailConfirmationRedirectUrl(): string {
  return getAppOrigin();
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
