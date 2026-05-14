-- Super-admin cross-tenant WRITE audit log.
--
-- Background:
--   The previous migration (20260514000001) shipped read-side logging
--   so tenants can see "who looked at my data". This migration ships
--   the matching write-side surface that the Round-2 governance audit
--   asked for: when a super-admin mutates another tenant's data, the
--   log row must include a justification, and the path is structurally
--   separate from reads so a tenant audit query like "who edited my
--   data?" can be answered cleanly.
--
-- What this migration does:
--   1. Adds a `kind` column to admin_cross_tenant_access_log
--      ('read' | 'write') with a CHECK constraint so we can't store
--      anything else.
--   2. Adds a NOT NULL `reason` text to writes via a partial CHECK:
--      reads keep reason NULL (no justification UX on every page load);
--      writes must supply one. The CHECK is partial-conditional on
--      `kind` so the existing read rows aren't retroactively invalid.
--   3. Introduces a SECURITY DEFINER function
--      `log_cross_tenant_write(p_company_id, p_path, p_host, p_reason)`
--      that enforces the same is_super_admin + non-member rules as the
--      read variant, requires reason >= 5 chars, and inserts a 'write'
--      row. Writes are NOT deduped within a window — every write is a
--      distinct event we want recorded.
--
-- What this migration does NOT do:
--   - It doesn't ship the step-up MFA challenge itself. That belongs
--     in the application layer (a /admin/step-up route + a session
--     "elevated until" flag). The auditor flagged step-up as a
--     recommendation, not a hard requirement; we're scaffolding the
--     audit-log half here so the write surface is ready when the
--     MFA layer lands.
--   - It doesn't add a "list writes for my company" route. The RLS
--     policy from the read migration already covers both kinds for
--     company managers; the route comes in the next release.

alter table public.admin_cross_tenant_access_log
  add column if not exists kind text not null default 'read';

-- Drop the old check (if any) so we can add a strict one. Idempotent:
-- the constraint name is stable.
alter table public.admin_cross_tenant_access_log
  drop constraint if exists admin_cross_tenant_access_log_kind_check;

alter table public.admin_cross_tenant_access_log
  add constraint admin_cross_tenant_access_log_kind_check
  check (kind in ('read', 'write'));

-- Writes must include a justification (>= 5 chars). Reads keep the
-- reason column NULL — no UX prompt on every page load.
alter table public.admin_cross_tenant_access_log
  drop constraint if exists admin_cross_tenant_access_log_write_reason_check;

alter table public.admin_cross_tenant_access_log
  add constraint admin_cross_tenant_access_log_write_reason_check
  check (
    kind = 'read'
    or (kind = 'write' and reason is not null and length(trim(reason)) >= 5)
  );

create index if not exists admin_cross_tenant_access_log_kind_company_idx
  on public.admin_cross_tenant_access_log (company_id, kind, accessed_at desc);

-- --------------------------------------------------------------------
-- log_cross_tenant_write(company_id, path, host, reason)
-- --------------------------------------------------------------------
-- Strict version of log_cross_tenant_access for write events. Differs
-- from the read variant in three ways:
--   1. `kind` column is set to 'write'.
--   2. `reason` is required and validated (>= 5 trimmed chars).
--   3. No 5-minute dedupe — every write is a distinct event.
-- Same security envelope: SECURITY DEFINER + re-checks
-- is_super_admin() + suppresses self-access so this only fires for
-- true cross-tenant writes.
create or replace function public.log_cross_tenant_write(
  p_company_id uuid,
  p_path text,
  p_host text,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_trimmed text := trim(coalesce(p_reason, ''));
begin
  if v_admin is null then
    return;
  end if;
  if not public.is_super_admin() then
    return;
  end if;
  if length(v_trimmed) < 5 then
    raise exception
      'log_cross_tenant_write requires a justification of at least 5 characters';
  end if;
  -- Suppress self-writes: super-admins who happen to own the company
  -- shouldn't pollute the cross-tenant log with their own edits.
  if exists (
    select 1 from public.company_members
    where company_id = p_company_id and user_id = v_admin
  ) then
    return;
  end if;
  insert into public.admin_cross_tenant_access_log(
    admin_user_id, company_id, path, request_host, kind, reason
  ) values (
    v_admin, p_company_id, p_path, p_host, 'write', v_trimmed
  );
end;
$$;

grant execute on function public.log_cross_tenant_write(uuid, text, text, text)
  to authenticated;
