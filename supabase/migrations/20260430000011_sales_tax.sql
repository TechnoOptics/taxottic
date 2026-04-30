-- Sales tax: per-state base rates (seeded with all 50 + DC) and a
-- per-(company, period, state) ledger for tracking what was
-- collected from customers, paid on purchases, and remitted to the
-- state. Also adds sales-tax breakdown columns on monthly_income
-- and monthly_expenses so users can record manually until bank-feed
-- data is the source of truth.

create table if not exists public.sales_tax_state_rates (
  state_code text primary key,
  state_name text not null,
  base_rate_pct numeric not null,
  effective_avg_rate_pct numeric,
  notes text,
  updated_at timestamptz not null default now()
);

insert into public.sales_tax_state_rates (state_code, state_name, base_rate_pct, effective_avg_rate_pct) values
  ('AL','Alabama',4.00,9.29), ('AK','Alaska',0.00,1.81),
  ('AZ','Arizona',5.60,8.38), ('AR','Arkansas',6.50,9.45),
  ('CA','California',7.25,8.85), ('CO','Colorado',2.90,7.81),
  ('CT','Connecticut',6.35,6.35), ('DE','Delaware',0.00,0.00),
  ('FL','Florida',6.00,7.00), ('GA','Georgia',4.00,7.39),
  ('HI','Hawaii',4.00,4.50), ('ID','Idaho',6.00,6.03),
  ('IL','Illinois',6.25,8.86), ('IN','Indiana',7.00,7.00),
  ('IA','Iowa',6.00,6.94), ('KS','Kansas',6.50,8.75),
  ('KY','Kentucky',6.00,6.00), ('LA','Louisiana',4.45,9.55),
  ('ME','Maine',5.50,5.50), ('MD','Maryland',6.00,6.00),
  ('MA','Massachusetts',6.25,6.25), ('MI','Michigan',6.00,6.00),
  ('MN','Minnesota',6.875,8.04), ('MS','Mississippi',7.00,7.07),
  ('MO','Missouri',4.225,8.39), ('MT','Montana',0.00,0.00),
  ('NE','Nebraska',5.50,6.97), ('NV','Nevada',6.85,8.24),
  ('NH','New Hampshire',0.00,0.00), ('NJ','New Jersey',6.625,6.60),
  ('NM','New Mexico',4.875,7.62), ('NY','New York',4.00,8.53),
  ('NC','North Carolina',4.75,7.00), ('ND','North Dakota',5.00,7.04),
  ('OH','Ohio',5.75,7.24), ('OK','Oklahoma',4.50,8.99),
  ('OR','Oregon',0.00,0.00), ('PA','Pennsylvania',6.00,6.34),
  ('RI','Rhode Island',7.00,7.00), ('SC','South Carolina',6.00,7.50),
  ('SD','South Dakota',4.20,6.11), ('TN','Tennessee',7.00,9.55),
  ('TX','Texas',6.25,8.20), ('UT','Utah',4.85,7.20),
  ('VT','Vermont',6.00,6.36), ('VA','Virginia',5.30,5.77),
  ('WA','Washington',6.50,9.43), ('WV','West Virginia',6.00,6.57),
  ('WI','Wisconsin',5.00,5.43), ('WY','Wyoming',4.00,5.44),
  ('DC','District of Columbia',6.00,6.00)
on conflict (state_code) do update set
  state_name = excluded.state_name,
  base_rate_pct = excluded.base_rate_pct,
  effective_avg_rate_pct = excluded.effective_avg_rate_pct,
  updated_at = now();

create table if not exists public.sales_tax_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tax_year int not null,
  period_kind text not null
    check (period_kind in ('monthly', 'quarterly', 'annual')),
  period_label text not null,
  state_code text not null references public.sales_tax_state_rates(state_code),
  collected_cents bigint not null default 0,
  paid_on_purchases_cents bigint not null default 0,
  remitted_cents bigint not null default 0,
  remitted_at date,
  filed_with_state boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, tax_year, period_kind, period_label, state_code)
);

create index if not exists sales_tax_records_company_idx
  on public.sales_tax_records (company_id, tax_year, period_kind);

alter table public.monthly_income
  add column if not exists sales_tax_collected_cents bigint,
  add column if not exists sales_tax_state_code text;

alter table public.monthly_expenses
  add column if not exists sales_tax_paid_cents bigint,
  add column if not exists sales_tax_state_code text;
