import { createHash, randomBytes, timingSafeEqual } from "crypto";

// Pure crypto for watch QR pairing — no Supabase/import side effects,
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

/** Short, human-unambiguous pairing code (no 0/O/1/I/L) for the QR.
 *  8 chars over a 30-symbol alphabet ≈ 39 bits — ample for a
 *  single-use code that lives ~120s. */
export function mintPairCode(): { code: string; codeHash: string } {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += alphabet[buf[i] % alphabet.length];
  return { code, codeHash: sha256Hex(code) };
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
