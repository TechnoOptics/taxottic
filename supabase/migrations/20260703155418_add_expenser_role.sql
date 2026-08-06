-- Recovered 20260703155418 (add_expenser_role) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter type public.company_role add value if not exists 'expenser';
