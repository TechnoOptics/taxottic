-- Recovered 20260428055029 (rls_policies) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.invitations enable row level security;
alter table public.super_admins enable row level security;

drop policy if exists "profiles: own row read" on public.profiles;
create policy "profiles: own row read"
  on public.profiles for select
  using (id = auth.uid());

drop policy if exists "profiles: super-admin read all" on public.profiles;
create policy "profiles: super-admin read all"
  on public.profiles for select
  using (public.is_super_admin());

drop policy if exists "profiles: company-mate read" on public.profiles;
create policy "profiles: company-mate read"
  on public.profiles for select
  using (
    exists (
      select 1
      from public.company_members me
      join public.company_members them on them.company_id = me.company_id
      where me.user_id = auth.uid() and them.user_id = profiles.id
    )
  );

drop policy if exists "profiles: own update" on public.profiles;
create policy "profiles: own update"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "companies: member read" on public.companies;
create policy "companies: member read"
  on public.companies for select
  using (public.is_company_member(id) or public.is_super_admin());

drop policy if exists "companies: any user create" on public.companies;
create policy "companies: any user create"
  on public.companies for insert
  with check (created_by = auth.uid());

drop policy if exists "companies: manager update" on public.companies;
create policy "companies: manager update"
  on public.companies for update
  using (public.is_company_manager(id) or public.is_super_admin())
  with check (public.is_company_manager(id) or public.is_super_admin());

drop policy if exists "companies: super-admin delete" on public.companies;
create policy "companies: super-admin delete"
  on public.companies for delete
  using (public.is_super_admin());

drop policy if exists "members: same-company read" on public.company_members;
create policy "members: same-company read"
  on public.company_members for select
  using (public.is_company_member(company_id) or public.is_super_admin());

drop policy if exists "members: manager insert" on public.company_members;
create policy "members: manager insert"
  on public.company_members for insert
  with check (public.is_company_manager(company_id) or public.is_super_admin());

drop policy if exists "members: manager delete" on public.company_members;
create policy "members: manager delete"
  on public.company_members for delete
  using (
    (public.is_company_manager(company_id) and user_id <> auth.uid())
    or public.is_super_admin()
  );

drop policy if exists "members: manager role change" on public.company_members;
create policy "members: manager role change"
  on public.company_members for update
  using (public.is_company_manager(company_id) or public.is_super_admin())
  with check (public.is_company_manager(company_id) or public.is_super_admin());

drop policy if exists "invites: manager read" on public.invitations;
create policy "invites: manager read"
  on public.invitations for select
  using (public.is_company_manager(company_id) or public.is_super_admin());

drop policy if exists "invites: invitee read by email" on public.invitations;
create policy "invites: invitee read by email"
  on public.invitations for select
  using (
    lower(email) = lower(coalesce(
      (select u.email from auth.users u where u.id = auth.uid()),
      ''
    ))
  );

drop policy if exists "invites: manager insert" on public.invitations;
create policy "invites: manager insert"
  on public.invitations for insert
  with check (public.is_company_manager(company_id));

drop policy if exists "invites: manager delete" on public.invitations;
create policy "invites: manager delete"
  on public.invitations for delete
  using (public.is_company_manager(company_id) or public.is_super_admin());

drop policy if exists "super_admins: super-admin read" on public.super_admins;
create policy "super_admins: super-admin read"
  on public.super_admins for select
  using (public.is_super_admin());
