-- Recovered 20260504190626 (bank_token_encryption) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.bank_connection_secrets
  add column if not exists access_token_enc text;

alter table public.bank_connection_secrets
  alter column access_token drop not null;
