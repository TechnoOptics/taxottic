-- Recovered 20260515005309 (entity_return_document_kinds) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

do $$ begin
  alter type public.firm_document_kind add value if not exists '1065_draft';
exception when others then null; end $$;

do $$ begin
  alter type public.firm_document_kind add value if not exists '1120_draft';
exception when others then null; end $$;

do $$ begin
  alter type public.firm_document_kind add value if not exists '1120_s_draft';
exception when others then null; end $$;
