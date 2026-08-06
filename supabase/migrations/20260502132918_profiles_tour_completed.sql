-- Recovered 20260502132918 (profiles_tour_completed) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.profiles
  add column if not exists tour_completed_at timestamptz;
