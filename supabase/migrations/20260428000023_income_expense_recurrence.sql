-- Allow each income / expense row to declare itself as a one-off cash event
-- or a recurring rate (the per-period amount). The forecast engine treats
-- the two differently:
--   one_off: the row is a sample; pace-project across the year.
--   monthly|quarterly|annual|weekly: the amount is the per-period rate, so
--     we expand it deterministically to year-end without pace scaling.
do $$ begin
  create type public.entry_recurrence as enum (
    'one_off',
    'weekly',
    'monthly',
    'quarterly',
    'annual'
  );
exception when duplicate_object then null; end $$;

alter table public.monthly_income
  add column if not exists recurrence public.entry_recurrence not null default 'one_off';

alter table public.monthly_expenses
  add column if not exists recurrence public.entry_recurrence not null default 'one_off';

-- Categories that almost always represent ongoing payments rather than
-- one-off events. The expense form uses this to default the cadence to
-- monthly so users don't have to think about it for the obvious cases.
alter table public.deduction_categories
  add column if not exists is_typically_recurring boolean not null default false;

update public.deduction_categories
set is_typically_recurring = true
where code in (
  'rent_property',     -- office / studio / coworking lease
  'rent_equipment',    -- equipment leases
  'software',          -- SaaS subscriptions
  'utilities',         -- internet / phone / electric / gas / water
  'insurance',         -- monthly business policies
  'interest_business', -- business loan interest
  'self_employed_health' -- monthly health-insurance premiums
);
