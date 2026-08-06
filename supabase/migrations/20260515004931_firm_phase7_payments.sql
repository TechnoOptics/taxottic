-- Recovered 20260515004931 (firm_phase7_payments) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.firm_stripe_accounts (
  firm_id uuid primary key references public.firms(id) on delete cascade,
  stripe_account_id text not null,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  details_submitted boolean not null default false,
  country text,
  default_currency text default 'usd',
  last_dashboard_link_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (stripe_account_id)
);

alter table public.firm_stripe_accounts enable row level security;

drop policy if exists "firm members read firm stripe account" on public.firm_stripe_accounts;
create policy "firm members read firm stripe account" on public.firm_stripe_accounts for select
  using (public.is_firm_member(firm_id) or public.is_super_admin());

drop policy if exists "firm owners manage firm stripe account" on public.firm_stripe_accounts;
create policy "firm owners manage firm stripe account" on public.firm_stripe_accounts for all
  using (public.is_firm_owner_or_manager(firm_id)) with check (public.is_firm_owner_or_manager(firm_id));

create or replace function public.firm_stripe_accounts_touch_updated_at()
returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end;
$fn$;
drop trigger if exists firm_stripe_accounts_touch on public.firm_stripe_accounts;
create trigger firm_stripe_accounts_touch before update on public.firm_stripe_accounts
  for each row execute function public.firm_stripe_accounts_touch_updated_at();

do $$ begin
  create type public.firm_invoice_status as enum ('draft','sent','viewed','paid','voided','refunded','failed');
exception when duplicate_object then null; end $$;

create table if not exists public.firm_invoices (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  engagement_id uuid references public.firm_engagements(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  invoice_number text not null,
  line_items jsonb not null default '[]'::jsonb,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  currency text not null default 'usd',
  platform_fee_bps int not null default 300,
  platform_fee_cents bigint not null default 0,
  recipient_email text not null,
  recipient_name text,
  reference_document_id uuid references public.firm_documents(id) on delete set null,
  due_at date,
  status public.firm_invoice_status not null default 'draft',
  stripe_checkout_session_id text,
  stripe_payment_intent_id text,
  stripe_hosted_invoice_url text,
  paid_at timestamptz,
  voided_at timestamptz,
  refunded_at timestamptz,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists firm_invoices_number_unique on public.firm_invoices (firm_id, invoice_number);
create index if not exists firm_invoices_firm_idx on public.firm_invoices (firm_id, created_at desc);
create index if not exists firm_invoices_engagement_idx on public.firm_invoices (engagement_id, created_at desc) where engagement_id is not null;
create index if not exists firm_invoices_status_idx on public.firm_invoices (firm_id, status, created_at desc);

alter table public.firm_invoices enable row level security;

drop policy if exists "firm members read invoices" on public.firm_invoices;
create policy "firm members read invoices" on public.firm_invoices for select
  using (public.is_firm_member(firm_id) or (company_id is not null and public.is_company_manager(company_id)) or public.is_super_admin());

drop policy if exists "firm owners write invoices" on public.firm_invoices;
create policy "firm owners write invoices" on public.firm_invoices for all
  using (public.is_firm_owner_or_manager(firm_id)) with check (public.is_firm_owner_or_manager(firm_id));

create or replace function public.firm_invoices_touch_updated_at()
returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end;
$fn$;
drop trigger if exists firm_invoices_touch on public.firm_invoices;
create trigger firm_invoices_touch before update on public.firm_invoices
  for each row execute function public.firm_invoices_touch_updated_at();

do $$ begin
  alter publication supabase_realtime add table public.firm_invoices;
exception when others then null; end $$;
