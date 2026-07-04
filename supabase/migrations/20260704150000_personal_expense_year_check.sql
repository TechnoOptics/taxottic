-- Audit hardening (finding F5): keep personal_expenses.tax_year honest.
--
-- The app derives tax_year from incurred_on and now rejects non-current-year
-- entries, but RLS only checks user_id, so a crafted POST could still insert a
-- row where tax_year disagrees with incurred_on's year (which would make the
-- row invisible to the tracker/forecast that filter on tax_year). This
-- constraint makes the two agree at the database level.
alter table public.personal_expenses
  drop constraint if exists personal_expenses_year_matches;

alter table public.personal_expenses
  add constraint personal_expenses_year_matches
  check (extract(year from incurred_on) = tax_year);
