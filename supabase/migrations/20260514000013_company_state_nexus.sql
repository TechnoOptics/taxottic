-- Multi-state apportionment scaffold.
--
-- The Round-2 audit asked: "if a business is registered in Minnesota
-- and does business in Chicago, does the necessary adjustments
-- happen?" — answer was no, the forecast treated each company as
-- single-state. This migration adds the per-state nexus table that
-- backs the new apportionment-aware tax math.
--
-- `company_state_nexus` records every state a company has tax
-- nexus in (resident state + each state they do business in), with
-- a sales-factor weight that drives the apportionment formula.
-- Most states use single-sales-factor apportionment; the
-- application defaults to that and lets the preparer override per
-- state.

create table if not exists public.company_state_nexus (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  /** 2-letter state code (uppercase). The company's resident state
   *  appears as `is_resident = true` exactly once per company. */
  state_code text not null check (length(state_code) = 2),
  /** True for the home state — gets the credit for taxes paid to
   *  other states (Schedule M1CR-equivalent). */
  is_resident boolean not null default false,
  /** Apportionment fraction in basis points (0-10000). The sum
   *  across all rows for a company should approach 10000 (100%);
   *  rounding tolerance is enforced application-side. */
  sales_factor_bps int not null default 0
    check (sales_factor_bps between 0 and 10000),
  /** Why this state was added — for audit / preparer note. */
  reason text,
  /** When the nexus started (move-in date, first sale into state,
   *  payroll first hire). Helps the preparer pro-rate the
   *  first-year filing. */
  nexus_started_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, state_code)
);

create index if not exists company_state_nexus_company_idx
  on public.company_state_nexus (company_id);

-- Exactly one resident state per company, enforced by partial
-- unique index.
create unique index if not exists company_state_nexus_one_resident
  on public.company_state_nexus (company_id)
  where is_resident = true;

alter table public.company_state_nexus enable row level security;

drop policy if exists "company members read nexus"
  on public.company_state_nexus;
create policy "company members read nexus"
  on public.company_state_nexus
  for select
  using (
    public.is_company_member(company_id)
    or public.firm_has_active_engagement_with(company_id)
    or public.is_super_admin()
  );

drop policy if exists "company managers write nexus"
  on public.company_state_nexus;
create policy "company managers write nexus"
  on public.company_state_nexus
  for all
  using (public.is_company_manager(company_id))
  with check (public.is_company_manager(company_id));

create or replace function public.company_state_nexus_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists company_state_nexus_touch on public.company_state_nexus;
create trigger company_state_nexus_touch
  before update on public.company_state_nexus
  for each row execute function public.company_state_nexus_touch_updated_at();

-- Helper: returns the resident state code (or NULL if the company
-- hasn't declared one yet — falls back to companies.state_code).
create or replace function public.company_resident_state(p_company_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select state_code
  from public.company_state_nexus
  where company_id = p_company_id
    and is_resident = true
  limit 1;
$$;

grant execute on function public.company_resident_state(uuid) to authenticated;
