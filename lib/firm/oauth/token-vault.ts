// OAuth token encryption + refresh.
//
// Phase 10 stored tokens as base64-encoded JSON in the
// `firm_calendar_integrations.encrypted_token_blob` column. That's
// not actually encrypted — anyone with read access to the column
// (super-admin or compromised service-role key) sees the
// access_token. Phase 10.5 upgrades to AEAD authenticated
// encryption using the AES-256-GCM primitive Node ships natively.
//
// Why we don't use pgsodium: pgsodium needs Supabase Vault setup
// + per-table envelope columns, which is more friction than the
// straightforward AEAD-in-app approach. AES-256-GCM with a
// rotated KEY env var gives us:
//   - confidentiality (key required to decrypt)
//   - integrity (GCM tag rejects tampering)
//   - forward compatibility (we can move to KMS or pgsodium later
//     without changing the call sites — only the encrypt/decrypt
//     helpers swap)
//
// The encrypted blob format is:
//   v1:base64(iv || ciphertext || authtag)
// The `v1:` prefix gives us a clean way to roll forward to v2
// (e.g., when we switch to KMS or rotate the key) — read paths
// detect the prefix and pick the right decrypt routine.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "v1:";

function getKey(): Buffer | null {
  // Allow either a hex / base64 KEY (32 bytes after decode) or a
  // longer passphrase that we SHA-256 down to 32 bytes. SHA-256 is
  // *not* a KDF in the strict sense, but our threat model assumes
  // the key is a high-entropy random string — SHA-256 just makes
  // sure the byte length is right.
  const raw =
    process.env.OAUTH_TOKEN_VAULT_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!raw) return null;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  // base64 length 44 (32 bytes + padding) handled here:
  if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

export function encryptTokenJson(payload: Record<string, unknown>): string {
  const key = getKey();
  if (!key) {
    throw new Error(
      "OAUTH_TOKEN_VAULT_KEY (or SUPABASE_SERVICE_ROLE_KEY fallback) missing",
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const json = Buffer.from(JSON.stringify(payload), "utf8");
  const enc = Buffer.concat([cipher.update(json), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, enc, tag]).toString("base64");
}

export function decryptTokenJson<T = Record<string, unknown>>(
  blob: string | null,
): T | null {
  if (!blob) return null;
  // Backwards-compatible: legacy v0 blobs are base64 JSON with no
  // version prefix. We detect them by the absence of "v1:" and
  // fall back to plain decode so calendars connected in Phase 10
  // keep working without forcing a reconnect.
  if (!blob.startsWith(PREFIX)) {
    try {
      return JSON.parse(Buffer.from(blob, "base64").toString("utf8")) as T;
    } catch {
      return null;
    }
  }
  const key = getKey();
  if (!key) return null;
  try {
    const buf = Buffer.from(blob.slice(PREFIX.length), "base64");
    if (buf.length < 12 + 16 + 1) return null;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const ct = buf.subarray(12, buf.length - 16);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(dec.toString("utf8")) as T;
  } catch {
    return null;
  }
}

/**
 * Convenience: read the access_token out of a stored blob. Used by
 * the calendar adapters + the refresh cron.
 */
export type DecodedToken = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: string; // ISO; populated when we mint the row
  scope?: string;
  token_type?: string;
};

export function decodeAccessToken(blob: string | null): string | null {
  const decoded = decryptTokenJson<DecodedToken>(blob);
  return decoded?.access_token ?? null;
}
