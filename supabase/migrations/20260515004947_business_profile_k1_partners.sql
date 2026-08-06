-- Recovered 20260515004947 (business_profile_k1_partners) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.business_profiles
  add column if not exists k1_partners jsonb not null default '[]'::jsonb;
