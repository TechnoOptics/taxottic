-- Recovered 20260516044141 (tax_disclaimer_accepted) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.profiles
  add column if not exists tax_disclaimer_accepted_at timestamptz;

comment on column public.profiles.tax_disclaimer_accepted_at is
  'When the user acknowledged the forecast/estimate legal disclaimer. NULL = show /onboarding/disclaimer before any other onboarding step.';
