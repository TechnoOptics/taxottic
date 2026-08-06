-- Recovered 20260515004657 (admin_cross_tenant_writes_log) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.admin_cross_tenant_access_log
  add column if not exists kind text not null default 'read';

alter table public.admin_cross_tenant_access_log
  drop constraint if exists admin_cross_tenant_access_log_kind_check;

alter table public.admin_cross_tenant_access_log
  add constraint admin_cross_tenant_access_log_kind_check
  check (kind in ('read', 'write'));

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

create or replace function public.log_cross_tenant_write(
  p_company_id uuid,
  p_path text,
  p_host text,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
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
$fn$;

grant execute on function public.log_cross_tenant_write(uuid, text, text, text)
  to authenticated;
