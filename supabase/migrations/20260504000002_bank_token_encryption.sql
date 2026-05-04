-- Encrypt-at-rest for Plaid (and other provider) access tokens.
--
-- Plaid's production-readiness checklist requires bank access tokens
-- to be encrypted at rest. The previous schema stored them in
-- bank_connection_secrets.access_token as plaintext, protected only
-- by RLS (service-role-only reads). RLS is great for stopping
-- application-level leaks, but it doesn't help if the database
-- bytes leak (backup exfiltration, snapshot mishap, etc.).
--
-- This migration adds access_token_enc, an opaque ciphertext blob.
-- Encryption + decryption happen in the application layer
-- (lib/crypto/bankTokens.ts) using AES-256-GCM with a key supplied
-- via the BANK_TOKEN_ENC_KEY env var. The DB sees only ciphertext.
--
-- Cutover plan:
--   1. This migration runs (additive, safe).
--   2. New code writes access_token_enc; reads prefer it but fall
--      back to the legacy plaintext column for any pre-migration
--      rows (sandbox-only at the time of writing).
--   3. Once a backfill encrypts the remaining plaintext rows, a
--      follow-up migration drops the access_token column.

alter table public.bank_connection_secrets
  add column if not exists access_token_enc text;

-- Drop the NOT NULL constraint on the legacy plaintext column so new
-- rows can be inserted with only the encrypted blob. We leave the
-- column itself in place to keep the read fallback simple during the
-- cutover window.
alter table public.bank_connection_secrets
  alter column access_token drop not null;
