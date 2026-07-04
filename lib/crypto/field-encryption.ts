// Field-level encryption for sensitive scalar identifiers at rest
// (SSN/EIN/TIN). Reuses the AES-256-GCM token vault so there's one key +
// one primitive to manage. Encrypted values carry the vault's `v1:` prefix;
// anything WITHOUT that prefix is treated as legacy plaintext and read
// through unchanged (dual-read), so a cutover never breaks existing rows and
// the column can hold a mix during migration.
//
// Usage:
//   write:  ein: encryptField(rawEin)          // -> "v1:..." or null
//   read:   const ein = decryptField(row.ein)  // -> plaintext or null
//
// SERVER ONLY, pulls in node:crypto via the token vault. Never import from
// a client component; decrypt on the server and pass the plaintext as a prop.

import { encryptTokenJson, decryptTokenJson } from "@/lib/firm/oauth/token-vault";

const PREFIX = "v1:";

/** Encrypt a sensitive scalar. Empty/blank -> null (nothing to protect). */
export function encryptField(plain: string | null | undefined): string | null {
  const v = (plain ?? "").trim();
  if (!v) return null;
  return encryptTokenJson({ v });
}

/**
 * Decrypt a sensitive scalar. Returns null for empty input. Values that
 * predate encryption (no `v1:` prefix) are returned verbatim so reads keep
 * working through the cutover.
 */
export function decryptField(blob: string | null | undefined): string | null {
  if (!blob) return null;
  if (!blob.startsWith(PREFIX)) return blob; // legacy plaintext, read through
  return decryptTokenJson<{ v: string }>(blob)?.v ?? null;
}
