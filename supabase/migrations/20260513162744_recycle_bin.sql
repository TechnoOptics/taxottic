-- Recovered 20260513162744 (recycle_bin) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Recycle bin: soft-delete + 30-day grace period for companies and
-- bank connections.

-- Companies: deleted_at
alter table public.companies
  add column if not exists deleted_at timestamptz;

create index if not exists companies_active_idx
  on public.companies (created_by)
  where deleted_at is null;

create index if not exists companies_deleted_idx
  on public.companies (deleted_at)
  where deleted_at is not null;

-- Bank connections: deleted_at
alter table public.bank_connections
  add column if not exists deleted_at timestamptz;

create index if not exists bank_connections_active_idx
  on public.bank_connections (company_id, status)
  where deleted_at is null;

create index if not exists bank_connections_deleted_idx
  on public.bank_connections (deleted_at)
  where deleted_at is not null;

-- Purge helper: hard-delete anything past the 30-day grace window.
create or replace function public.purge_expired_recycle_bin()
returns table (
  purged_companies int,
  purged_bank_connections int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - interval '30 days';
  co_count int := 0;
  bc_count int := 0;
begin
  with deleted as (
    delete from public.bank_connections
    where deleted_at is not null
      and deleted_at < cutoff
    returning 1
  )
  select count(*) into bc_count from deleted;

  with deleted as (
    delete from public.companies
    where deleted_at is not null
      and deleted_at < cutoff
    returning 1
  )
  select count(*) into co_count from deleted;

  return query select co_count, bc_count;
end;
$$;

revoke all on function public.purge_expired_recycle_bin() from public;
grant execute on function public.purge_expired_recycle_bin() to authenticated, service_role;

-- Recycle-bin view: convenience for /settings/recycle-bin
create or replace view public.recycle_bin as
  select
    'company'::text as kind,
    c.id as id,
    c.public_id as public_id,
    c.name as title,
    c.created_by as owner_user_id,
    c.deleted_at as deleted_at,
    (c.deleted_at + interval '30 days') as purge_at
  from public.companies c
  where c.deleted_at is not null
union all
  select
    'bank_connection'::text as kind,
    bc.id as id,
    bc.id::text as public_id,
    coalesce(bc.institution_name, 'Unknown bank') as title,
    cm.user_id as owner_user_id,
    bc.deleted_at as deleted_at,
    (bc.deleted_at + interval '30 days') as purge_at
  from public.bank_connections bc
  join public.company_members cm on cm.company_id = bc.company_id
  where bc.deleted_at is not null
    and cm.role = 'manager';

grant select on public.recycle_bin to authenticated;

comment on view public.recycle_bin is
  'Per-user soft-deleted items awaiting the 30-day hard-delete sweep. Used by /settings/recycle-bin.';
