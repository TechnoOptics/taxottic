-- Recovered 20260515005013 (firm_phase11_efilings) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

do $$ begin
  create type public.firm_efiling_form as enum (
    'form_1040','form_1040_x','form_1065','form_1120','form_1120_s','form_990',
    'form_941','form_944','form_940','form_w2','form_1099_nec','form_1099_misc',
    'state_income','state_sales_tax','other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.firm_efiling_status as enum ('prepared','queued','submitted','accepted','rejected','amended','cancelled');
exception when duplicate_object then null; end $$;

create table if not exists public.firm_efilings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  engagement_id uuid references public.firm_engagements(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  document_id uuid references public.firm_documents(id) on delete set null,
  form public.firm_efiling_form not null,
  tax_year int not null,
  period_end date,
  jurisdiction text not null check (jurisdiction = 'federal' or length(jurisdiction) = 2),
  status public.firm_efiling_status not null default 'prepared',
  submission_target text,
  provider_submission_id text,
  submitted_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  reject_reason text,
  acknowledgment_payload jsonb,
  preparer_user_id uuid references public.profiles(id) on delete set null,
  preparer_ptin text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists firm_efilings_firm_idx on public.firm_efilings (firm_id, created_at desc);
create index if not exists firm_efilings_engagement_idx on public.firm_efilings (engagement_id, tax_year, form) where engagement_id is not null;
create index if not exists firm_efilings_status_idx on public.firm_efilings (firm_id, status, created_at desc);

alter table public.firm_efilings enable row level security;

drop policy if exists "firm admins read all efilings" on public.firm_efilings;
create policy "firm admins read all efilings" on public.firm_efilings for select
  using (public.is_firm_owner_or_manager(firm_id) or public.is_super_admin());

drop policy if exists "firm preparers read assigned efilings" on public.firm_efilings;
create policy "firm preparers read assigned efilings" on public.firm_efilings for select
  using (public.is_firm_member(firm_id) and engagement_id is not null
    and exists (select 1 from public.firm_engagements where id = firm_efilings.engagement_id and assigned_preparer_id = auth.uid()));

drop policy if exists "client reads own company efilings" on public.firm_efilings;
create policy "client reads own company efilings" on public.firm_efilings for select
  using (company_id is not null and public.is_company_manager(company_id));

drop policy if exists "firm members create efilings" on public.firm_efilings;
create policy "firm members create efilings" on public.firm_efilings for insert with check (public.is_firm_member(firm_id));

drop policy if exists "firm owners update efilings" on public.firm_efilings;
create policy "firm owners update efilings" on public.firm_efilings for update using (public.is_firm_owner_or_manager(firm_id));

create or replace function public.firm_efilings_touch_updated_at()
returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end;
$fn$;
drop trigger if exists firm_efilings_touch on public.firm_efilings;
create trigger firm_efilings_touch before update on public.firm_efilings
  for each row execute function public.firm_efilings_touch_updated_at();

do $$ begin
  alter publication supabase_realtime add table public.firm_efilings;
exception when others then null; end $$;
