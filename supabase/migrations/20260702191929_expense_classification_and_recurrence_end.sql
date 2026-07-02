-- Three related expense-model corrections, all requested together:
--
-- 1. Income belongs to the BUSINESS, never an individual employee.
--    monthly_income.user_id already only records who entered the row
--    (an audit trail), not "whose income" it is — no schema change
--    needed here, this is a reporting-layer fix (see forecast/breakdown
--    page.tsx, which stops slicing income per department/employee).
--
-- 2. A manager needs to leave a note on an expense and/or reclassify it
--    to personal (i.e. NOT a business write-off) without deleting it —
--    e.g. reviewing a teammate's logged expense and catching a personal
--    purchase that got miscategorized as business.
--
-- 3. A recurring expense needs an explicit end point. Today `recurrence`
--    projects a row forward to December with no way to say "this
--    stopped in month N" — a cancelled subscription keeps inflating the
--    forecast indefinitely. recurrence_end_month lets the user (or a
--    future automated "hasn't shown up in N months" check) cap the
--    projection.
alter table public.monthly_expenses
  add column if not exists classification text not null default 'business',
  add column if not exists manager_note text,
  add column if not exists recurrence_end_month integer;

alter table public.monthly_expenses
  drop constraint if exists monthly_expenses_classification_check;
alter table public.monthly_expenses
  add constraint monthly_expenses_classification_check
  check (classification in ('business', 'personal'));

alter table public.monthly_expenses
  drop constraint if exists monthly_expenses_recurrence_end_month_check;
alter table public.monthly_expenses
  add constraint monthly_expenses_recurrence_end_month_check
  check (recurrence_end_month is null or recurrence_end_month between 1 and 12);
