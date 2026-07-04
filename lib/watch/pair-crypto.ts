import { createHash, randomBytes, randomInt, timingSafeEqual } from "crypto";

// Pure crypto for watch pairing, no Supabase/import side effects,
// so it unit-tests in isolation. We persist only HASHES of the code
// and the token; the plaintexts are short-lived and never stored
// long-term, so a DB leak is not replayable.

export const sha256Hex = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

/** A 256-bit url-safe watch bearer token. Only its hash is persisted. */
export function mintWatchToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: sha256Hex(token) };
}

/**
 * Six-digit numeric pairing code the watch displays and the user
 * types into Phone → Settings → Devices.
 *
 * Entropy: 10^6 = ~20 bits. That's a LOT less than the old 8-char
 * base-30 QR code (~39 bits), so the redeem endpoint MUST cap
 * attempts per IP/user (see /api/watch/pair/redeem), otherwise an
 * attacker could brute the active code inside its 120-second
 * window. With a 5-req/min cap a guesser gets ~10 tries per code
 * lifetime, so the probability of a successful guess is ~10⁻⁵.
 *
 * Unbiased: `randomInt(0, 1_000_000)` gives a uniform integer; we
 * zero-pad so leading zeros are preserved and a stolen log line
 * doesn't accidentally collapse "012345" and "12345" to the same
 * code.
 */
export function mintPairCode(): { code: string; codeHash: string } {
  const n = randomInt(0, 1_000_000);
  const code = String(n).padStart(6, "0");
  return { code, codeHash: sha256Hex(code) };
}

/** Strip everything that isn't a digit so users can paste/type
 *  "012-345", "012 345" or "012345" interchangeably. */
export function normalizePairCode(raw: string): string {
  return raw.replace(/\D+/g, "");
}

export const hashPairCode = (code: string): string => sha256Hex(code);

/** Constant-time hex-digest compare. */
export function safeHexEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}
