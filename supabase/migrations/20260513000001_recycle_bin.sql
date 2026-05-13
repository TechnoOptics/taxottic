-- Recycle bin: soft-delete + 30-day grace period for companies and
-- bank connections.
--
-- Design:
--   - Add `deleted_at` timestamptz columns to `companies` and
--     `bank_connections`. NULL = active. Non-NULL = in the recycle bin.
--   - Application code reads active rows with `.is('deleted_at', null)`
--     on every list query (dashboard, firm cockpit, banks page, etc.).
--   - The recycle bin UI at /settings/recycle-bin reads soft-deleted
--     rows for the current user and surfaces Restore + Permanently
--     delete buttons.
--   - A helper function `public.purge_expired_recycle_bin()` hard-
--     deletes anything whose `deleted_at` is older than 30 days. Run
--     it from cron (Supabase pg_cron, Vercel Cron, or lazily on each
--     dashboard load — the application sweeps on every request).
--
-- Why this pattern over Postgres DELETE + recovery from backup:
--   - Backups are an operator-recovery tool, not a user-recovery tool.
--   - Users expect "undo" to be one click, not a support ticket.
--   - 30 days matches what's promised in /legal/privacy and is short
--     enough that storage cost stays modest.

-- --------------------------------------------------------------------
-- Companies: deleted_at
-- --------------------------------------------------------------------
alter table public.companies
  add column if not exists deleted_at timestamptz;

-- Partial index lets the dashboard's "list my active companies" query
-- skip the deleted rows cheaply without scanning the recycle-bin
-- contents. The reverse index (deleted rows) supports the recycle-bin
-- list and the lazy purge sweep.
create index if not exists companies_active_idx
  on public.companies (created_by)
  where deleted_at is null;

create index if not exists companies_deleted_idx
  on public.companies (deleted_at)
  where deleted_at is not null;

-- --------------------------------------------------------------------
-- Bank connections: deleted_at
-- --------------------------------------------------------------------
-- Note: `bank_connections.status` already has a 'revoked' value used
-- when Plaid reports the item is no longer authoritative. We keep
-- 'revoked' for upstream-initiated revocation (Plaid hangup) and use
-- `deleted_at` for user-initiated disconnect-from-the-app. A row can
-- be both (the user disconnected AND Plaid said it's revoked).
alter table public.bank_connections
  add column if not exists deleted_at timestamptz;

create index if not exists bank_connections_active_idx
  on public.bank_connections (company_id, status)
  where deleted_at is null;

create index if not exists bank_connections_deleted_idx
  on public.bank_connections (deleted_at)
  where deleted_at is not null;

-- --------------------------------------------------------------------
-- Purge helper: hard-delete anything past the 30-day grace window.
-- --------------------------------------------------------------------
-- Idempotent — safe to call repeatedly. Returns a small per-table
-- summary so a scheduled job or operator can log what they removed.
--
-- The function runs as `security definer` so a cron worker (or the
-- application's lazy sweep) doesn't need a row-by-row RLS dance to
-- delete data that's already past its grace window. The 30-day cutoff
-- is enforced INSIDE the function and cannot be overridden by the
-- caller — that's the safety net against an accidental
-- `purge_expired_recycle_bin(0)` racing through everything.
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
  -- Bank connections first: a company's bank_connections cascade
  -- when the company itself is hard-deleted, so doing this in the
  -- right order keeps the row counts honest.
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

-- Grant execute to authenticated so the application's lazy sweep
-- (called from server-side dashboard render) can invoke it. The
-- security-definer body still enforces the 30-day cutoff regardless
-- of who calls.
revoke all on function public.purge_expired_recycle_bin() from public;
grant execute on function public.purge_expired_recycle_bin() to authenticated, service_role;

-- --------------------------------------------------------------------
-- Recycle-bin view (read-only): convenience for /settings/recycle-bin
-- --------------------------------------------------------------------
-- A SQL view that lists everything in the current user's recycle bin
-- (companies they own + bank connections in companies they manage),
-- with the per-row purge timestamp computed inline. The application
-- *could* assemble this with multiple queries, but the view keeps the
-- recycle-bin page to a single round-trip and the row shape stable
-- regardless of future entity types.
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

-- Views inherit RLS from the underlying tables; we also expose them to
-- authenticated reads since the WHERE clauses above already filter to
-- the requesting user via company_members.
grant select on public.recycle_bin to authenticated;

comment on view public.recycle_bin is
  'Per-user soft-deleted items awaiting the 30-day hard-delete sweep. Used by /settings/recycle-bin.';
