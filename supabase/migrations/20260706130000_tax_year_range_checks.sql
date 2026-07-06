-- Audit hygiene: tax_year columns had no range check, so a crafted insert could
-- store nonsense (e.g. tax_year = 99999) that the forecast/queries would then
-- silently mishandle. Add a sane 2000-2100 bound. Verified live data is all
-- 2024-2026, so the constraint applies cleanly. Constraints are dropped-then-
-- added so this migration is idempotent (re-runnable), the pattern the audit
-- flagged as missing on several older ADD CONSTRAINT statements.

alter table public.monthly_income
  drop constraint if exists monthly_income_tax_year_range;
alter table public.monthly_income
  add constraint monthly_income_tax_year_range
  check (tax_year between 2000 and 2100);

alter table public.monthly_expenses
  drop constraint if exists monthly_expenses_tax_year_range;
alter table public.monthly_expenses
  add constraint monthly_expenses_tax_year_range
  check (tax_year between 2000 and 2100);

alter table public.personal_expenses
  drop constraint if exists personal_expenses_tax_year_range;
alter table public.personal_expenses
  add constraint personal_expenses_tax_year_range
  check (tax_year between 2000 and 2100);

alter table public.tax_profiles
  drop constraint if exists tax_profiles_tax_year_range;
alter table public.tax_profiles
  add constraint tax_profiles_tax_year_range
  check (tax_year between 2000 and 2100);

alter table public.business_profiles
  drop constraint if exists business_profiles_tax_year_range;
alter table public.business_profiles
  add constraint business_profiles_tax_year_range
  check (tax_year between 2000 and 2100);
