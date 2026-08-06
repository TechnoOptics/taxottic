-- Recovered 20260505161716 (prior_year_for_person) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.prior_year_documents
  add column if not exists for_person text not null default 'self'
  check (for_person in ('self', 'spouse'));

create index if not exists prior_year_docs_for_person_idx
  on public.prior_year_documents (user_id, tax_year, for_person)
  where applied_at is null;
