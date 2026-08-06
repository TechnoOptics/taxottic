-- Recovered 20260627223200 (monthly_income_recurring_key) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.monthly_income
  add column if not exists recurring_key text;

create index if not exists monthly_income_recurring_key_idx
  on public.monthly_income (company_id, tax_year, recurring_key)
  where recurring_key is not null;
