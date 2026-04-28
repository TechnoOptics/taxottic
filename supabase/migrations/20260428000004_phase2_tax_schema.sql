-- Taxottic Phase 2: tax profiles, business profiles, monthly entries, deduction taxonomy.
-- All tables are RLS-enforced; only members of a company can read/write its data,
-- with super-admin global read.

-- ----------------------------------------------------------------------------
-- Personal tax profile - one row per (user, tax_year)
-- ----------------------------------------------------------------------------
create type public.filing_status as enum (
  'single',
  'married_filing_jointly',
  'married_filing_separately',
  'head_of_household',
  'qualifying_widow'
);

create table if not exists public.tax_profiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  tax_year int not null,
  filing_status public.filing_status not null default 'single',
  state_code text,
  spouse_income_cents bigint,
  dependents int not null default 0,
  age int,
  is_blind boolean not null default false,
  itemize boolean not null default false,
  estimated_payments_cents bigint not null default 0,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (user_id, tax_year)
);

-- ----------------------------------------------------------------------------
-- Per-company business profile - one row per (company, tax_year)
-- ----------------------------------------------------------------------------
create table if not exists public.business_profiles (
  company_id uuid not null references public.companies(id) on delete cascade,
  tax_year int not null,
  expected_revenue_cents bigint,
  has_employees boolean not null default false,
  has_vehicle boolean not null default false,
  has_home_office boolean not null default false,
  home_office_sqft int,
  home_total_sqft int,
  vehicle_method text,             -- 'standard' | 'actual'
  vehicle_business_miles int,
  primary_industry text,
  notes text,
  updated_at timestamptz not null default now(),
  primary key (company_id, tax_year)
);

-- ----------------------------------------------------------------------------
-- Deduction taxonomy - shared lookup table.
-- Categories are mostly Schedule C lines for businesses, plus a handful of
-- personal/itemized categories. Each category has an "applies_to" tag so the UI
-- can filter when adding to a personal vs business expense.
-- ----------------------------------------------------------------------------
create type public.deduction_scope as enum ('business', 'personal', 'both');

create table if not exists public.deduction_categories (
  code text primary key,           -- stable machine code, used as foreign key
  label text not null,             -- short user-facing label
  description text not null,       -- one-line explainer; fed to Bella later
  scope public.deduction_scope not null default 'business',
  schedule_c_line text,            -- e.g. "Line 8" / "Line 22" - null if not on Sch C
  irs_pub text,                    -- e.g. "Pub 535" - reference for citation
  is_meal boolean not null default false,    -- meals subject to 50% limit
  is_vehicle boolean not null default false, -- vehicle gets special treatment
  display_order int not null default 0
);

-- ----------------------------------------------------------------------------
-- Monthly income - per-company entries
-- ----------------------------------------------------------------------------
create type public.income_source as enum (
  'sales',
  'services',
  'wages_w2',
  'interest',
  'dividends',
  'rental',
  'royalty',
  'other'
);

create table if not exists public.monthly_income (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  tax_year int not null,
  month int not null check (month between 1 and 12),
  amount_cents bigint not null check (amount_cents >= 0),
  source public.income_source not null default 'sales',
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists monthly_income_company_year_idx
  on public.monthly_income (company_id, tax_year, month);

-- ----------------------------------------------------------------------------
-- Monthly expenses - per-company entries; category from deduction_categories
-- ----------------------------------------------------------------------------
create table if not exists public.monthly_expenses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  tax_year int not null,
  month int not null check (month between 1 and 12),
  amount_cents bigint not null check (amount_cents >= 0),
  category_code text not null references public.deduction_categories(code) on delete restrict,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists monthly_expenses_company_year_idx
  on public.monthly_expenses (company_id, tax_year, month);
create index if not exists monthly_expenses_category_idx
  on public.monthly_expenses (category_code);

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------
drop trigger if exists tax_profiles_touch on public.tax_profiles;
create trigger tax_profiles_touch before update on public.tax_profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists business_profiles_touch on public.business_profiles;
create trigger business_profiles_touch before update on public.business_profiles
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table public.tax_profiles enable row level security;
alter table public.business_profiles enable row level security;
alter table public.deduction_categories enable row level security;
alter table public.monthly_income enable row level security;
alter table public.monthly_expenses enable row level security;

-- tax_profiles: own rows only (super-admin read all)
drop policy if exists "tax_profiles: own read" on public.tax_profiles;
create policy "tax_profiles: own read"
  on public.tax_profiles for select
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "tax_profiles: own write" on public.tax_profiles;
create policy "tax_profiles: own write"
  on public.tax_profiles for insert
  with check (user_id = auth.uid());

drop policy if exists "tax_profiles: own update" on public.tax_profiles;
create policy "tax_profiles: own update"
  on public.tax_profiles for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "tax_profiles: own delete" on public.tax_profiles;
create policy "tax_profiles: own delete"
  on public.tax_profiles for delete
  using (user_id = auth.uid());

-- business_profiles: any company member can read; only managers can write
drop policy if exists "business_profiles: member read" on public.business_profiles;
create policy "business_profiles: member read"
  on public.business_profiles for select
  using (public.is_company_member(company_id) or public.is_super_admin());

drop policy if exists "business_profiles: manager insert" on public.business_profiles;
create policy "business_profiles: manager insert"
  on public.business_profiles for insert
  with check (public.is_company_manager(company_id));

drop policy if exists "business_profiles: manager update" on public.business_profiles;
create policy "business_profiles: manager update"
  on public.business_profiles for update
  using (public.is_company_manager(company_id) or public.is_super_admin())
  with check (public.is_company_manager(company_id) or public.is_super_admin());

-- deduction_categories: readable by anyone signed in (it's reference data)
drop policy if exists "deduction_categories: read all" on public.deduction_categories;
create policy "deduction_categories: read all"
  on public.deduction_categories for select
  using (auth.uid() is not null);

-- monthly_income: any company member can read; member can insert/update their own;
-- managers can update/delete any in their company
drop policy if exists "monthly_income: member read" on public.monthly_income;
create policy "monthly_income: member read"
  on public.monthly_income for select
  using (public.is_company_member(company_id) or public.is_super_admin());

drop policy if exists "monthly_income: member insert" on public.monthly_income;
create policy "monthly_income: member insert"
  on public.monthly_income for insert
  with check (
    public.is_company_member(company_id)
    and user_id = auth.uid()
  );

drop policy if exists "monthly_income: own or manager update" on public.monthly_income;
create policy "monthly_income: own or manager update"
  on public.monthly_income for update
  using (
    (public.is_company_member(company_id) and user_id = auth.uid())
    or public.is_company_manager(company_id)
    or public.is_super_admin()
  )
  with check (
    (public.is_company_member(company_id) and user_id = auth.uid())
    or public.is_company_manager(company_id)
    or public.is_super_admin()
  );

drop policy if exists "monthly_income: own or manager delete" on public.monthly_income;
create policy "monthly_income: own or manager delete"
  on public.monthly_income for delete
  using (
    (public.is_company_member(company_id) and user_id = auth.uid())
    or public.is_company_manager(company_id)
    or public.is_super_admin()
  );

-- monthly_expenses: same pattern as income
drop policy if exists "monthly_expenses: member read" on public.monthly_expenses;
create policy "monthly_expenses: member read"
  on public.monthly_expenses for select
  using (public.is_company_member(company_id) or public.is_super_admin());

drop policy if exists "monthly_expenses: member insert" on public.monthly_expenses;
create policy "monthly_expenses: member insert"
  on public.monthly_expenses for insert
  with check (
    public.is_company_member(company_id)
    and user_id = auth.uid()
  );

drop policy if exists "monthly_expenses: own or manager update" on public.monthly_expenses;
create policy "monthly_expenses: own or manager update"
  on public.monthly_expenses for update
  using (
    (public.is_company_member(company_id) and user_id = auth.uid())
    or public.is_company_manager(company_id)
    or public.is_super_admin()
  )
  with check (
    (public.is_company_member(company_id) and user_id = auth.uid())
    or public.is_company_manager(company_id)
    or public.is_super_admin()
  );

drop policy if exists "monthly_expenses: own or manager delete" on public.monthly_expenses;
create policy "monthly_expenses: own or manager delete"
  on public.monthly_expenses for delete
  using (
    (public.is_company_member(company_id) and user_id = auth.uid())
    or public.is_company_manager(company_id)
    or public.is_super_admin()
  );
