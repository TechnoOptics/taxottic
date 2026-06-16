-- Charitable donations — personal §170 (Schedule A) giving, tracked
-- SEPARATELY from business (Schedule C) expenses so the amounts never
-- pollute the business forecast or expense totals. One row per gift.
--
-- Why a dedicated table instead of a monthly_expenses row: charitable
-- contributions are a PERSONAL itemized deduction that flows to the
-- donor's 1040 Schedule A, not the company's return. Dropping them into
-- monthly_expenses (which the Expenses page + forecast sum as business
-- deductions) would overstate the business deduction. So this lives at
-- the user (donor) level, company-independent.
--
-- Drives two things: the "Philanthropist" achievement badge
-- (lib/badges/evaluate.ts awards it on the first logged gift) and a
-- running "given this year" tally on the deduction explorer. We encourage
-- generosity for its own sake; the deduction is a bonus, and only helps
-- when the donor itemizes.

create table if not exists public.charitable_donations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tax_year integer not null,
  amount_cents bigint not null check (amount_cents > 0),
  -- 'cash' = money/check/card; 'noncash' = goods, clothing, stock, etc.
  kind text not null default 'cash' check (kind in ('cash', 'noncash')),
  recipient text,
  donated_on date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);

create index if not exists charitable_donations_user_year_idx
  on public.charitable_donations (user_id, tax_year);

alter table public.charitable_donations enable row level security;

create policy "charitable_donations: own select"
  on public.charitable_donations for select
  using (user_id = auth.uid());

create policy "charitable_donations: own insert"
  on public.charitable_donations for insert
  with check (user_id = auth.uid());

create policy "charitable_donations: own update"
  on public.charitable_donations for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "charitable_donations: own delete"
  on public.charitable_donations for delete
  using (user_id = auth.uid());
