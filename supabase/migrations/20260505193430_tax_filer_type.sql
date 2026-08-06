-- Recovered 20260505193430 (tax_filer_type) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.profiles
  add column if not exists tax_filer_type text
    check (tax_filer_type in ('w2', 'business'));

create index if not exists profiles_tax_filer_type_idx
  on public.profiles (tax_filer_type);

comment on column public.profiles.tax_filer_type is
  'W-2 wage-earner mode (no company) vs business mode (Schedule C). NULL = pre-fork users; treated as business.';
