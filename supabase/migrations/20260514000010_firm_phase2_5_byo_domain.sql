-- Phase 2.5: bring-your-own custom domain for firms.
--
-- Enterprise-tier firms can point their own domain (e.g.,
-- smithcpa-secure.com) at Taxottic's wildcard hosting. The
-- mapping table records each domain claim with the verification
-- state Vercel returns from /v9/projects/{project}/domains.

do $$ begin
  create type public.firm_domain_status as enum (
    'pending_dns',     -- DNS not yet pointing at Vercel
    'pending_ssl',     -- DNS resolved, SSL still issuing
    'active',          -- live + serving
    'suspended',       -- firm tier downgraded or domain disputed
    'removed'          -- firm explicitly removed
  );
exception when duplicate_object then null; end $$;

create table if not exists public.firm_custom_domains (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  /** Lowercase ASCII domain (no protocol, no path). */
  hostname text not null,
  /** Tier-gate: enterprise only for now. */
  required_tier public.firm_tier not null default 'enterprise',
  status public.firm_domain_status not null default 'pending_dns',
  /** Vercel's domain object id, for follow-up status reads. */
  vercel_domain_id text,
  /** Verification record details from Vercel — TXT or CNAME
   *  the firm has to add to their DNS. */
  verification_record jsonb,
  added_by uuid references public.profiles(id) on delete set null,
  added_at timestamptz not null default now(),
  verified_at timestamptz,
  removed_at timestamptz,
  notes text
);

-- Hostname uniqueness via a functional unique index (inline
-- `unique (lower(hostname))` isn't valid Postgres syntax for
-- expression-based constraints — must be a separate index).
create unique index if not exists firm_custom_domains_hostname_unique
  on public.firm_custom_domains (lower(hostname));

create index if not exists firm_custom_domains_firm_idx
  on public.firm_custom_domains (firm_id);

alter table public.firm_custom_domains enable row level security;

drop policy if exists "firm members read firm domains"
  on public.firm_custom_domains;
create policy "firm members read firm domains"
  on public.firm_custom_domains
  for select
  using (
    public.is_firm_member(firm_id)
    or public.is_super_admin()
  );

drop policy if exists "firm owners manage firm domains"
  on public.firm_custom_domains;
create policy "firm owners manage firm domains"
  on public.firm_custom_domains
  for all
  using (public.is_firm_owner_or_manager(firm_id))
  with check (public.is_firm_owner_or_manager(firm_id));

-- Realtime so the verification panel reflects DNS propagation as
-- soon as our status-poll cron updates the row.
do $$ begin
  alter publication supabase_realtime add table public.firm_custom_domains;
exception when others then null; end $$;
