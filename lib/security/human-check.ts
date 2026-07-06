// Our own human-verification gate for the browser sign-in form (item 18).
//
// This is a homegrown "prove you're human" check, deliberately NOT a
// third-party CAPTCHA. It raises the bar for naive automation hammering the
// magic-link endpoint: to get a pass token a client must (1) fetch a
// server-issued, HMAC-signed nonce, then (2) redeem it only after a genuine
// trusted pointer interaction with human-plausible timing and cursor entropy.
// Both the nonce and the pass are signed here so neither can be forged
// client-side, and both carry a short expiry so they can't be stockpiled.
//
// It is not a silver bullet: a determined attacker scripting a real browser
// can still clear it, and it does not run in the native app at all (the
// Capacitor shell is a trusted first-party client). Supabase Auth's own
// per-IP rate limiting remains the backstop for sophisticated abuse; this
// gate handles the common case of drive-by bots and casual scripts.

import { createHmac, timingSafeEqual } from "node:crypto";

// Server-only secret. Falls back to the service-role key (always present
// server-side) so the gate works even before a dedicated secret is set in
// the environment. Never shipped to the client.
function secret(): string {
  return (
    process.env.HUMAN_CHECK_SECRET ??
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    "taxottic-human-check-dev-secret"
  );
}

const NONCE_TTL_MS = 5 * 60 * 1000; // a challenge is valid for 5 minutes
const PASS_TTL_MS = 10 * 60 * 1000; // a pass is good for 10 minutes after solving

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("hex");
}

/** Constant-time compare of two hex signatures of equal length. */
function sigEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
  } catch {
    return false;
  }
}

export type Challenge = { nonce: string; exp: number; sig: string };

/** Issue a fresh signed challenge for the client to solve. */
export function issueChallenge(nonce: string, now: number): Challenge {
  const exp = now + NONCE_TTL_MS;
  return { nonce, exp, sig: sign(`challenge:${nonce}:${exp}`) };
}

export type SolveMetrics = {
  /** ms between the challenge mounting and the human clicking. */
  elapsedMs: number;
  /** number of pointer/touch move samples seen before the click. */
  moves: number;
  /** the browser reported the click came from a trusted (real) event. */
  trusted: boolean;
};

// Human-plausible bounds. A real person takes at least a beat to notice and
// click, moves the pointer on the way, and the event is browser-trusted. A
// naive script fires instantly, with no movement, from an untrusted event.
const MIN_ELAPSED_MS = 600;
const MAX_ELAPSED_MS = NONCE_TTL_MS;
const MIN_MOVES = 3;

export type Pass = { pass: string; exp: number };

/**
 * Verify a solved challenge. Returns a signed pass token on success, or a
 * reason string on failure. The nonce signature + expiry prove the challenge
 * came from us and is fresh; the metrics prove a human solved it.
 */
export function verifySolve(
  ch: Challenge,
  metrics: SolveMetrics,
  now: number,
): { ok: true; value: Pass } | { ok: false; reason: string } {
  if (!sigEqual(ch.sig, sign(`challenge:${ch.nonce}:${ch.exp}`))) {
    return { ok: false, reason: "bad_signature" };
  }
  if (now > ch.exp) return { ok: false, reason: "expired" };
  if (!metrics.trusted) return { ok: false, reason: "untrusted_event" };
  if (metrics.elapsedMs < MIN_ELAPSED_MS || metrics.elapsedMs > MAX_ELAPSED_MS) {
    return { ok: false, reason: "timing" };
  }
  if (metrics.moves < MIN_MOVES) return { ok: false, reason: "no_interaction" };

  const exp = now + PASS_TTL_MS;
  return {
    ok: true,
    value: { pass: sign(`pass:${ch.nonce}:${exp}`), exp },
  };
}

/**
 * Re-verify a pass token (nonce + expiry + signature).
 *
 * IMPORTANT: the current login integration is CLIENT-SIDE deterrence only.
 * Supabase's magic-link / OTP send happens directly from the browser, so the
 * login form gates on a client boolean and this pass token is not yet checked
 * in the sign-in path. The challenge round-trip still forces a real,
 * server-issued interaction (friction against naive bots), but a determined
 * script that calls supabase.auth directly bypasses it. To make the gate
 * server-enforced, route the OTP/magic-link request through a first-party
 * endpoint that calls verifyPass() before proxying to Supabase. This helper
 * exists for exactly that hardening step; keep it until then.
 */
export function verifyPass(nonce: string, token: string, exp: number, now: number): boolean {
  if (now > exp) return false;
  return sigEqual(token, sign(`pass:${nonce}:${exp}`));
}
