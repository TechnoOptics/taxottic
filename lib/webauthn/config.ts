/**
 * WebAuthn relying-party configuration.
 *
 * `rpID` must be the registrable domain (no scheme, no port, no path).
 *   localhost          for local dev
 *   taxottic.com       for production
 *
 * `origin` must include scheme + host (and port for localhost). Multiple
 * origins can be allowed (e.g., naked + www variants).
 *
 * Sourced from `NEXT_PUBLIC_SITE_URL` env so prod and dev are consistent.
 */

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

function originFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "http://localhost:3000";
  }
}

function hostnameFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "localhost";
  }
}

export const RP_NAME = "Taxottic";
export const RP_ID = hostnameFromUrl(SITE_URL);
export const EXPECTED_ORIGIN = [
  originFromUrl(SITE_URL),
  // also allow www. variant in production
  RP_ID.startsWith("www.") ? null : `${originFromUrl(SITE_URL).replace(RP_ID, "www." + RP_ID)}`,
].filter(Boolean) as string[];

// Keep auth challenges short-lived (5 min). Cookie name + signing happens via
// the existing Supabase session machinery on register; for sign-in we use
// a dedicated cookie because the user isn't signed in yet.
export const CHALLENGE_COOKIE = "tx_passkey_challenge";
export const CHALLENGE_TTL_SECONDS = 300;
