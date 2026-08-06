-- Recovered 20260515004637 (admin_cross_tenant_access_log) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.admin_cross_tenant_access_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  path text,
  reason text,
  request_host text,
  accessed_at timestamptz not null default now()
);

create index if not exists admin_cross_tenant_access_log_admin_idx
  on public.admin_cross_tenant_access_log (admin_user_id, accessed_at desc);

create index if not exists admin_cross_tenant_access_log_company_idx
  on public.admin_cross_tenant_access_log (company_id, accessed_at desc);

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

create or replace function public.log_cross_tenant_access(
  p_company_id uuid,
  p_path text,
  p_host text
) returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_admin uuid := auth.uid();
begin
  if v_admin is null then
    return;
  end if;
  if not public.is_super_admin() then
    return;
  end if;
  if exists (
    select 1 from public.company_members
    where company_id = p_company_id and user_id = v_admin
  ) then
    return;
  end if;
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
$fn$;

grant execute on function public.log_cross_tenant_access(uuid, text, text)
  to authenticated;
