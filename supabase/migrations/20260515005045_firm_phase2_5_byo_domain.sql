-- Recovered 20260515005045 (firm_phase2_5_byo_domain) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

do $$ begin
  create type public.firm_domain_status as enum ('pending_dns','pending_ssl','active','suspended','removed');
exception when duplicate_object then null; end $$;

create table if not exists public.firm_custom_domains (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  hostname text not null,
  required_tier public.firm_tier not null default 'enterprise',
  status public.firm_domain_status not null default 'pending_dns',
  vercel_domain_id text,
  verification_record jsonb,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  verified_at timestamptz,
  removed_at timestamptz,
  notes text
);

create unique index if not exists firm_custom_domains_hostname_unique
  on public.firm_custom_domains (lower(hostname));

create index if not exists firm_custom_domains_firm_idx on public.firm_custom_domains (firm_id);

alter table public.firm_custom_domains enable row level security;

drop policy if exists "firm members read firm domains" on public.firm_custom_domains;
create policy "firm members read firm domains" on public.firm_custom_domains for select
  using (public.is_firm_member(firm_id) or public.is_super_admin());

drop policy if exists "firm owners manage firm domains" on public.firm_custom_domains;
create policy "firm owners manage firm domains" on public.firm_custom_domains for all
  using (public.is_firm_owner_or_manager(firm_id)) with check (public.is_firm_owner_or_manager(firm_id));

do $$ begin
  alter publication supabase_realtime add table public.firm_custom_domains;
exception when others then null; end $$;
