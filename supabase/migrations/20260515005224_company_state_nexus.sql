-- Recovered 20260515005224 (company_state_nexus) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.company_state_nexus (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  state_code text not null check (length(state_code) = 2),
  is_resident boolean not null default false,
  sales_factor_bps int not null default 0 check (sales_factor_bps between 0 and 10000),
  reason text,
  nexus_started_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, state_code)
);

create index if not exists company_state_nexus_company_idx on public.company_state_nexus (company_id);
create unique index if not exists company_state_nexus_one_resident on public.company_state_nexus (company_id) where is_resident = true;

alter table public.company_state_nexus enable row level security;

drop policy if exists "company members read nexus" on public.company_state_nexus;
create policy "company members read nexus" on public.company_state_nexus for select
  using (public.is_company_member(company_id) or public.firm_has_active_engagement_with(company_id) or public.is_super_admin());

drop policy if exists "company managers write nexus" on public.company_state_nexus;
create policy "company managers write nexus" on public.company_state_nexus for all
  using (public.is_company_manager(company_id)) with check (public.is_company_manager(company_id));

create or replace function public.company_state_nexus_touch_updated_at()
returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end;
$fn$;
drop trigger if exists company_state_nexus_touch on public.company_state_nexus;
create trigger company_state_nexus_touch before update on public.company_state_nexus
  for each row execute function public.company_state_nexus_touch_updated_at();

create or replace function public.company_resident_state(p_company_id uuid)
returns text language sql stable security definer set search_path = public as $fn$
  select state_code from public.company_state_nexus
  where company_id = p_company_id and is_resident = true limit 1;
$fn$;

grant execute on function public.company_resident_state(uuid) to authenticated;
