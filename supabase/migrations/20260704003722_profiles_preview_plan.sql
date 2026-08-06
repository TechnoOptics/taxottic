-- Recovered 20260704003722 (profiles_preview_plan) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.profiles
  add column if not exists preview_plan text
    check (preview_plan in ('free', 'filer', 'solo', 'studio', 'scale', 'practice'));

comment on column public.profiles.preview_plan is
  'Super-admin QA override: pins the effective plan in getActivePlan() so an admin can preview each tier''s gated experience. Null = default (practice for super-admins). Ignored for non-super-admins.';
