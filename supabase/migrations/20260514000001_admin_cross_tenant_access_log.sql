-- Super-admin cross-tenant access log.
--
-- Background:
--   Super-admins can read any company's data (RLS bypass via
--   public.is_super_admin()). The May 2026 governance audit asked for
--   four things:
--     1. A visible banner on cross-tenant page loads (UI work; not in
--        this migration).
--     2. An audit log of every cross-tenant read so we can answer "who
--        looked at my data" requests from tenant owners.
--     3. A surface that exposes each tenant's own access log.
--     4. Disclosure in /legal/privacy + /legal/security.
--
-- This migration ships (2). The table holds one row per cross-tenant
-- page load. The application calls a SECURITY DEFINER function that
-- inserts the row, so we don't have to grant raw INSERT on the table
-- to authenticated. The same function dedupes inserts within a short
-- TTL so opening 5 sub-pages of one tenant in 30 seconds doesn't
-- create 5 rows for the same intent.
--
-- Why TIMESTAMPTZ vs. just "today's date":
--   Tenants are likely to ask "what time did this person open my
--   data?". Coarser than seconds, but day-level resolution would
--   make a real incident harder to reconstruct.
--
-- Why a separate table vs. tacking a column onto an existing one:
--   This data is append-only and write-heavy in the worst case (a
--   support session walking through ten tenants is ten rows). Keep
--   it physically separate from operational tables so a stray
--   bulk-write doesn't slow the dashboard query plan.

create table if not exists public.admin_cross_tenant_access_log (
  id uuid primary key default gen_random_uuid(),
  -- The admin user who performed the read. References auth.users via
  -- the consumer profiles row so we get cascade-safe deletion if
  -- the user is fully purged.
  admin_user_id uuid not null references public.profiles(id) on delete cascade,
  -- The company that was read.
  company_id uuid not null references public.companies(id) on delete cascade,
  -- The request path that triggered the read (e.g. /c/abc123/forecast).
  -- Trimmed to the path; query strings stripped at the application
  -- layer so we don't accidentally store any PII from form posts.
  path text,
  -- Optional reason / justification — currently always NULL because
  -- the app doesn't require it on read. Reserved for the planned
  -- step-up requirement on writes.
  reason text,
  -- Coarse identifier of the client (host header) so we can tell
  -- enterprise.taxottic.com reads apart from taxottic.com reads in
  -- a future tenant-facing log surface.
  request_host text,
  accessed_at timestamptz not null default now()
);

-- Read indexes:
--   - by admin_user_id for "what did this support agent touch today?"
--   - by company_id for "who read MY company?" — the tenant-facing
--     log requires a covering index by company_id + accessed_at desc
--     so the page query is fast even at scale.
create index if not exists admin_cross_tenant_access_log_admin_idx
  on public.admin_cross_tenant_access_log (admin_user_id, accessed_at desc);

create index if not exists admin_cross_tenant_access_log_company_idx
  on public.admin_cross_tenant_access_log (company_id, accessed_at desc);

-- RLS: lock the table down. The SECURITY DEFINER helper writes the
-- rows; admins read their own audit history; tenant owners read the
-- subset that pertains to their company.
alter table public.admin_cross_tenant_access_log enable row level security;

drop policy if exists "admin reads own audit history"
  on public.admin_cross_tenant_access_log;
create policy "admin reads own audit history"
  on public.admin_cross_tenant_access_log
  for select
  using (
    admin_user_id = auth.uid()
    or public.is_super_admin()
  );

drop policy if exists "tenant manager reads cross-tenant log for their companies"
  on public.admin_cross_tenant_access_log;
create policy "tenant manager reads cross-tenant log for their companies"
  on public.admin_cross_tenant_access_log
  for select
  using (
    public.is_company_manager(company_id)
  );

-- The insert path is the SECURITY DEFINER function below — no row-
-- writer policy on the table at all. authenticated users cannot
-- directly INSERT.

-- --------------------------------------------------------------------
-- log_cross_tenant_access(company_id, path, host)
-- --------------------------------------------------------------------
-- Idempotent within a 5-minute window so the audit log doesn't
-- balloon when one admin clicks rapidly across the same tenant's
-- sub-pages (forecast → income → expenses → forecast). The dedupe
-- is by (admin_user_id, company_id, path). When the admin moves to
-- a different path (e.g. /banks), that's a new audit row regardless
-- of the time window — different surface, different intent.
create or replace function public.log_cross_tenant_access(
  p_company_id uuid,
  p_path text,
  p_host text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null then
    return;
  end if;
  if not public.is_super_admin() then
    return;
  end if;
  -- Suppress self-access: super-admins ALSO own companies sometimes.
  -- The banner / log are only meant for true cross-tenant reads.
  if exists (
    select 1 from public.company_members
    where company_id = p_company_id and user_id = v_admin
  ) then
    return;
  end if;
  -- Dedupe within 5 minutes per (admin, company, path).
  if exists (
    select 1 from public.admin_cross_tenant_access_log
    where admin_user_id = v_admin
      and company_id = p_company_id
      and coalesce(path, '') = coalesce(p_path, '')
      and accessed_at > now() - interval '5 minutes'
  ) then
    return;
  end if;
  insert into public.admin_cross_tenant_access_log(
    admin_user_id, company_id, path, request_host
  ) values (
    v_admin, p_company_id, p_path, p_host
  );
end;
$$;

grant execute on function public.log_cross_tenant_access(uuid, text, text)
  to authenticated;
