-- Live bank-connection foundation. Plaid is the v1 provider; the
-- schema admits multiple via `provider`. Naming sidesteps the
-- existing CSV-import tables (bank_imports + bank_transactions) by
-- using account_* names for the live-feed flow.

create table if not exists public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  provider text not null default 'plaid'
    check (provider in ('plaid', 'teller', 'mx', 'manual')),
  external_item_id text unique,
  institution_id text,
  institution_name text,
  institution_logo_url text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'needs_reauth', 'revoked', 'error')),
  cursor text,
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bank_connections_company_idx
  on public.bank_connections (company_id, status);

create table if not exists public.bank_connection_secrets (
  connection_id uuid primary key references public.bank_connections(id) on delete cascade,
  access_token text not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.bank_connections(id) on delete cascade,
  external_account_id text unique,
  name text,
  official_name text,
  account_type text,
  account_subtype text,
  mask text,
  current_balance_cents bigint,
  available_balance_cents bigint,
  iso_currency_code text default 'USD',
  is_excluded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bank_accounts_connection_idx
  on public.bank_accounts (connection_id);

create table if not exists public.account_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.bank_accounts(id) on delete cascade,
  external_transaction_id text unique,
  posted_date date not null,
  authorized_date date,
  amount_cents bigint not null,
  iso_currency_code text default 'USD',
  merchant_name text,
  description text,
  payment_channel text,
  category_path text[],
  personal_finance_category text,
  is_pending boolean not null default false,
  user_action text not null default 'pending'
    check (user_action in ('pending', 'applied', 'dismissed', 'split')),
  applied_to_expense_id uuid references public.monthly_expenses(id) on delete set null,
  applied_to_income_id uuid references public.monthly_income(id) on delete set null,
  applied_at timestamptz,
  applied_by uuid references auth.users(id) on delete set null,
  sales_tax_cents bigint,
  sales_tax_state_code text,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_tx_account_idx
  on public.account_transactions (account_id, posted_date desc);
create index if not exists account_tx_action_idx
  on public.account_transactions (user_action);
create index if not exists account_tx_external_idx
  on public.account_transactions (external_transaction_id);

create table if not exists public.account_transaction_suggestions (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.account_transactions(id) on delete cascade,
  suggested_deduction_code text references public.deduction_categories(code),
  suggested_recurrence public.entry_recurrence,
  confidence numeric not null,
  rule_name text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists ats_transaction_idx
  on public.account_transaction_suggestions (transaction_id) where is_active;
