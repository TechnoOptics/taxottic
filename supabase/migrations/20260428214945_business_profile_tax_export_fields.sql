-- Recovered 20260428214945 (business_profile_tax_export_fields) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Optional fields for the year-end PDF export (handed to a tax preparer).
-- All optional; the export page degrades gracefully when missing.
alter table public.business_profiles
  add column if not exists ein text,
  add column if not exists legal_name text,
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city text,
  add column if not exists zip text,
  add column if not exists phone text,
  add column if not exists business_email text;
