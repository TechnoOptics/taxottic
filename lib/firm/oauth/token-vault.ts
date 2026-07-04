// OAuth token + sensitive-field encryption, with key rotation.
//
// Phase 10 stored tokens as base64-encoded JSON in the
// `firm_calendar_integrations.encrypted_token_blob` column. That's
// not actually encrypted, anyone with read access to the column
// (super-admin or compromised service-role key) sees the
// access_token. Phase 10.5 upgrades to AEAD authenticated
// encryption using the AES-256-GCM primitive Node ships natively.
// Field-level secrets (SSN/EIN/TIN) reuse the same primitive via
// lib/crypto/field-encryption.
//
// The encrypted blob format is:
//   v1:base64(iv || ciphertext || authtag)
// The `v1:` prefix gives us a clean way to roll forward to v2
// (e.g., when we switch to KMS), read paths detect the prefix.
//
// ── Key rotation ──────────────────────────────────────────────
// Encryption always uses the PRIMARY key. Decryption tries the
// primary first, then any OLD keys, so a rotation is zero-downtime:
//
//   1. Generate a new 32-byte key.
//   2. Deploy with OAUTH_TOKEN_VAULT_KEY = <new> and
//      OAUTH_TOKEN_VAULT_KEYS_OLD = <previous>[,<older>...].
//      New writes use <new>; existing ciphertext still decrypts via
//      the old key(s).
//   3. (Optional housekeeping) Run a backfill that calls
//      reencryptBlob() over the stored blobs to migrate them onto
//      the new key, isOnPrimaryKey() lets it skip already-migrated
//      rows.
//   4. Once nothing decrypts under the old key, drop it from
//      OAUTH_TOKEN_VAULT_KEYS_OLD.

import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const ALGORITHM = "aes-256-gcm";
const PREFIX = "v1:";

function toKey(raw: string): Buffer {
  // Allow either a hex / base64 KEY (32 bytes after decode) or a
  // longer passphrase that we SHA-256 down to 32 bytes.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  if (/^[A-Za-z0-9+/]{43}=$/.test(raw)) {
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) return buf;
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

/**
 * All keys to consider, primary first. Primary is OAUTH_TOKEN_VAULT_KEY
 * (falling back to SUPABASE_SERVICE_ROLE_KEY when unset, as before);
 * OAUTH_TOKEN_VAULT_KEYS_OLD holds comma-separated retired keys kept
 * around only so their ciphertext stays readable during a rotation.
 */
function getKeys(): Buffer[] {
  const primary =
    process.env.OAUTH_TOKEN_VAULT_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  const olds = (process.env.OAUTH_TOKEN_VAULT_KEYS_OLD ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [primary, ...olds]
    .filter((s): s is string => Boolean(s))
    .map(toKey);
}

function decryptWith(key: Buffer, blob: string): unknown | undefined {
  try {
    const buf = Buffer.from(blob.slice(PREFIX.length), "base64");
    if (buf.length < 12 + 16 + 1) return undefined;
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(buf.length - 16);
    const ct = buf.subarray(12, buf.length - 16);
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const dec = Buffer.concat([decipher.update(ct), decipher.final()]);
    return JSON.parse(dec.toString("utf8"));
  } catch {
    return undefined;
  }
}

export function encryptTokenJson(payload: Record<string, unknown>): string {
  const key = getKeys()[0];
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
  // version prefix (Phase 10 calendars). Decode without decryption.
  if (!blob.startsWith(PREFIX)) {
    try {
      return JSON.parse(Buffer.from(blob, "base64").toString("utf8")) as T;
    } catch {
      return null;
    }
  }
  // Try each configured key (primary, then retired) so a rotation in
  // progress doesn't strand ciphertext written under the old key.
  for (const key of getKeys()) {
    const out = decryptWith(key, blob);
    if (out !== undefined) return out as T;
  }
  return null;
}

/**
 * True when the blob decrypts under the CURRENT primary key, i.e. it does
 * NOT need re-encryption after a rotation. Legacy v0 (unprefixed) blobs and
 * undecryptable blobs return false.
 */
export function isOnPrimaryKey(blob: string | null): boolean {
  if (!blob || !blob.startsWith(PREFIX)) return false;
  const primary = getKeys()[0];
  if (!primary) return false;
  return decryptWith(primary, blob) !== undefined;
}

/**
 * Decrypt with any configured key (or decode a legacy v0 blob) and
 * re-encrypt under the primary key. Returns the new `v1:` blob, or null if
 * the value can't be read. Used by the rotation backfill to migrate stored
 * ciphertext onto the current key.
 */
export function reencryptBlob(blob: string | null): string | null {
  const obj = decryptTokenJson(blob);
  if (obj == null) return null;
  return encryptTokenJson(obj as Record<string, unknown>);
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
