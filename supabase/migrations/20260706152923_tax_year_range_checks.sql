-- Recovered 20260706152923 (tax_year_range_checks) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.monthly_income drop constraint if exists monthly_income_tax_year_range;
alter table public.monthly_income add constraint monthly_income_tax_year_range check (tax_year between 2000 and 2100);

alter table public.monthly_expenses drop constraint if exists monthly_expenses_tax_year_range;
alter table public.monthly_expenses add constraint monthly_expenses_tax_year_range check (tax_year between 2000 and 2100);

alter table public.personal_expenses drop constraint if exists personal_expenses_tax_year_range;
alter table public.personal_expenses add constraint personal_expenses_tax_year_range check (tax_year between 2000 and 2100);

alter table public.tax_profiles drop constraint if exists tax_profiles_tax_year_range;
alter table public.tax_profiles add constraint tax_profiles_tax_year_range check (tax_year between 2000 and 2100);

alter table public.business_profiles drop constraint if exists business_profiles_tax_year_range;
alter table public.business_profiles add constraint business_profiles_tax_year_range check (tax_year between 2000 and 2100);
