import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/**
 * Symmetric encryption for bank-provider access tokens.
 *
 * Plaid (and similar providers) hand us a long-lived access_token per
 * linked Item. We persist it in bank_connection_secrets so cron and
 * webhooks can run syncs without the user present. Plaid's
 * production-readiness checklist requires those tokens be encrypted
 * at rest; RLS alone doesn't satisfy the requirement because it does
 * not protect raw database bytes (backups, snapshots, leaked dumps).
 *
 * Cipher: AES-256-GCM. Authenticated, no padding, 12-byte IV per
 * encryption, 16-byte auth tag verified on decrypt. We package the
 * three components as one base64 string so the caller stores a
 * single text column.
 *
 * Key: 32 bytes (256 bits) supplied via the BANK_TOKEN_ENC_KEY env
 * var, encoded as base64 or hex. Generate one with
 *   openssl rand -base64 32
 * Set it on every environment that talks to Plaid (Vercel + local
 * .env.local). Rotation is a future migration: re-encrypt every row
 * with the new key, ship both keys briefly, then retire the old.
 */

const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

function decodeKey(): Buffer {
  const raw = process.env.BANK_TOKEN_ENC_KEY;
  if (!raw) {
    throw new Error(
      "BANK_TOKEN_ENC_KEY is not set; cannot encrypt or decrypt bank tokens",
    );
  }
  // Accept base64 or hex. Try base64 first because that's the
  // recommended generator output (openssl rand -base64 32).
  let buf = Buffer.from(raw, "base64");
  if (buf.length !== KEY_BYTES) {
    buf = Buffer.from(raw, "hex");
  }
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `BANK_TOKEN_ENC_KEY must decode to ${KEY_BYTES} bytes (got ${buf.length}); use \`openssl rand -base64 32\``,
    );
  }
  return buf;
}

export function encryptBankToken(plaintext: string): string {
  const key = decodeKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString("base64");
}

export function decryptBankToken(payload: string): string {
  const key = decodeKey();
  const buf = Buffer.from(payload, "base64");
  if (buf.length < IV_BYTES + TAG_BYTES) {
    throw new Error("encrypted bank token payload is too short");
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(buf.length - TAG_BYTES);
  const ct = buf.subarray(IV_BYTES, buf.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
