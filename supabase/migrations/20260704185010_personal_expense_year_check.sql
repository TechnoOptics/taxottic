-- Recovered 20260704185010 (personal_expense_year_check) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.personal_expenses
  drop constraint if exists personal_expenses_year_matches;

alter table public.personal_expenses
  add constraint personal_expenses_year_matches
  check (extract(year from incurred_on) = tax_year);
