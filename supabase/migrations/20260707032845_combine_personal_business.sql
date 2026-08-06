-- Recovered 20260707032845 (combine_personal_business) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.profiles
  add column if not exists combine_personal_business boolean;

comment on column public.profiles.combine_personal_business is
  'User preference: fold business (pass-through) net into the personal tax forecast. NULL = use the entity-type-aware default (pass-through combined, C-corp separate). Set explicitly by the Settings toggle.';
