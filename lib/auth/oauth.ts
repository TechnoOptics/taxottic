// Shared utilities for the OAuth-on-our-domain flow.
//
// Why we run OAuth on our own domain instead of letting Supabase be the
// redirect target: when the redirect_uri belongs to Supabase
// (https://<ref>.supabase.co/auth/v1/callback), Google and Microsoft show
// the project ref on the consent screen ("to continue to <ref>.supabase.co").
// By making redirect_uri point to taxottic.com, the consent screen reads
// "to continue to taxottic.com", which is what end users expect.
//
// The flow:
//   1. /api/auth/<provider>/start sets HttpOnly state + nonce cookies and
//      redirects the browser to the provider's authorize URL.
//   2. The provider returns the user to /api/auth/<provider>/callback with
//      ?code & ?state. We verify the state cookie, exchange code for tokens
//      against the provider's token endpoint, then hand the resulting
//      ID token to Supabase via supabase.auth.signInWithIdToken so that
//      the @supabase/ssr cookies get written and the session is live.

import { randomBytes } from "crypto";

export const STATE_COOKIE = "taxottic_oauth_state";
export const NONCE_COOKIE = "taxottic_oauth_nonce";
export const NEXT_COOKIE = "taxottic_oauth_next";

// 10 minutes - plenty of time for a user to complete the consent screen,
// short enough that a leaked state cookie isn't a long-lived risk.
export const COOKIE_MAX_AGE = 60 * 10;

/**
 * Cryptographically random URL-safe string.
 * 32 bytes -> 43 base64url chars after stripping padding. Long enough to
 * make CSRF guessing infeasible.
 */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/**
 * Resolve the absolute origin we redirect through.
 *
 * We prefer NEXT_PUBLIC_SITE_URL (set in Vercel) so the redirect_uri exactly
 * matches what's registered with the provider. Falling back to the request
 * origin lets local dev work without extra configuration.
 */
export function siteOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/$/, "");
  return new URL(req.url).origin;
}

/**
 * Validate and normalize the post-login redirect target. We only accept
 * same-origin paths (must start with `/` and not `//`) so an attacker can't
 * craft `?next=https://evil.example` and have us bounce the user there
 * after a real Supabase session has been minted.
 */
export function safeNext(input: string | null | undefined): string {
  if (!input) return "/dashboard";
  if (!input.startsWith("/")) return "/dashboard";
  if (input.startsWith("//")) return "/dashboard";
  return input;
}
