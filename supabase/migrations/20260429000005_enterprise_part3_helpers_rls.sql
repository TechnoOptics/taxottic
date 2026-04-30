-- Helper functions + RLS for enterprise tables.

create or replace function public.is_firm_member(p_firm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.firm_members fm
    where fm.firm_id = p_firm_id
      and fm.user_id = auth.uid()
  );
$$;

create or replace function public.is_firm_owner_or_manager(p_firm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.firm_members fm
    where fm.firm_id = p_firm_id
      and fm.user_id = auth.uid()
      and fm.role in ('owner', 'manager')
  );
$$;

create or replace function public.firm_has_active_engagement_with(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.firm_engagements e
    join public.firm_members fm on fm.firm_id = e.firm_id
    where e.company_id = p_company_id
      and e.status = 'active'
      and fm.user_id = auth.uid()
  );
$$;

grant execute on function public.is_firm_member(uuid) to authenticated;
grant execute on function public.is_firm_owner_or_manager(uuid) to authenticated;
grant execute on function public.firm_has_active_engagement_with(uuid) to authenticated;

alter table public.firms enable row level security;
alter table public.firm_members enable row level security;
alter table public.firm_invitations enable row level security;
alter table public.firm_access_requests enable row level security;
alter table public.firm_engagements enable row level security;
alter table public.audit_cases enable row level security;
alter table public.audit_notes enable row level security;
alter table public.audit_documents enable row level security;

drop policy if exists "firms: member or super read" on public.firms;
create policy "firms: member or super read"
  on public.firms for select
  using (public.is_firm_member(id) or public.is_super_admin());

drop policy if exists "firms: public read active" on public.firms;
create policy "firms: public read active"
  on public.firms for select
  using (status = 'active');

drop policy if exists "firms: super insert" on public.firms;
create policy "firms: super insert"
  on public.firms for insert
  with check (public.is_super_admin());

drop policy if exists "firms: super or owner update" on public.firms;
create policy "firms: super or owner update"
  on public.firms for update
  using (public.is_super_admin() or public.is_firm_owner_or_manager(id));

drop policy if exists "fm: visible to firm members or super" on public.firm_members;
create policy "fm: visible to firm members or super"
  on public.firm_members for select
  using (public.is_firm_member(firm_id) or public.is_super_admin());

drop policy if exists "fm: super or manager insert" on public.firm_members;
create policy "fm: super or manager insert"
  on public.firm_members for insert
  with check (public.is_super_admin() or public.is_firm_owner_or_manager(firm_id));

drop policy if exists "fm: super or manager update" on public.firm_members;
create policy "fm: super or manager update"
  on public.firm_members for update
  using (public.is_super_admin() or public.is_firm_owner_or_manager(firm_id));

drop policy if exists "fm: self leave or manager remove" on public.firm_members;
create policy "fm: self leave or manager remove"
  on public.firm_members for delete
  using (
    user_id = auth.uid()
    or public.is_firm_owner_or_manager(firm_id)
    or public.is_super_admin()
  );

drop policy if exists "fi: firm member read" on public.firm_invitations;
create policy "fi: firm member read"
  on public.firm_invitations for select
  using (public.is_firm_member(firm_id) or public.is_super_admin());

drop policy if exists "fi: manager insert" on public.firm_invitations;
create policy "fi: manager insert"
  on public.firm_invitations for insert
  with check (public.is_firm_owner_or_manager(firm_id));

drop policy if exists "fi: manager update or invitee accept" on public.firm_invitations;
create policy "fi: manager update or invitee accept"
  on public.firm_invitations for update
  using (
    public.is_firm_owner_or_manager(firm_id)
    or accepted_by = auth.uid()
  );

drop policy if exists "fi: manager delete" on public.firm_invitations;
create policy "fi: manager delete"
  on public.firm_invitations for delete
  using (public.is_firm_owner_or_manager(firm_id) or public.is_super_admin());

drop policy if exists "far: anon insert" on public.firm_access_requests;
create policy "far: anon insert"
  on public.firm_access_requests for insert
  with check (true);

drop policy if exists "far: super read" on public.firm_access_requests;
create policy "far: super read"
  on public.firm_access_requests for select
  using (public.is_super_admin());

drop policy if exists "far: super update" on public.firm_access_requests;
create policy "far: super update"
  on public.firm_access_requests for update
  using (public.is_super_admin());

drop policy if exists "eng: firm or company side read" on public.firm_engagements;
create policy "eng: firm or company side read"
  on public.firm_engagements for select
  using (
    public.is_firm_member(firm_id)
    or public.is_company_member(company_id)
    or public.is_super_admin()
  );

drop policy if exists "eng: side insert" on public.firm_engagements;
create policy "eng: side insert"
  on public.firm_engagements for insert
  with check (
    (
      requested_by_side = 'client'
      and public.is_company_member(company_id)
      and requested_by = auth.uid()
    ) or (
      requested_by_side = 'firm'
      and public.is_firm_owner_or_manager(firm_id)
      and requested_by = auth.uid()
    )
    or public.is_super_admin()
  );

drop policy if exists "eng: side update" on public.firm_engagements;
create policy "eng: side update"
  on public.firm_engagements for update
  using (
    public.is_firm_member(firm_id)
    or public.is_company_manager(company_id)
    or public.is_super_admin()
  );

drop policy if exists "audit: firm side read" on public.audit_cases;
create policy "audit: firm side read"
  on public.audit_cases for select
  using (
    exists (
      select 1 from public.firm_engagements e
      where e.id = audit_cases.engagement_id
        and public.is_firm_member(e.firm_id)
    )
    or public.is_super_admin()
  );

drop policy if exists "audit: firm side write" on public.audit_cases;
create policy "audit: firm side write"
  on public.audit_cases for insert
  with check (
    exists (
      select 1 from public.firm_engagements e
      where e.id = audit_cases.engagement_id
        and public.is_firm_member(e.firm_id)
    )
  );

drop policy if exists "audit: firm side update" on public.audit_cases;
create policy "audit: firm side update"
  on public.audit_cases for update
  using (
    exists (
      select 1 from public.firm_engagements e
      where e.id = audit_cases.engagement_id
        and public.is_firm_member(e.firm_id)
    )
  );

drop policy if exists "audit: firm side delete" on public.audit_cases;
create policy "audit: firm side delete"
  on public.audit_cases for delete
  using (
    exists (
      select 1 from public.firm_engagements e
      where e.id = audit_cases.engagement_id
        and public.is_firm_owner_or_manager(e.firm_id)
    )
  );

drop policy if exists "audit_notes: firm read" on public.audit_notes;
create policy "audit_notes: firm read"
  on public.audit_notes for select
  using (
    exists (
      select 1 from public.audit_cases ac
      join public.firm_engagements e on e.id = ac.engagement_id
      where ac.id = audit_notes.audit_case_id
        and public.is_firm_member(e.firm_id)
    )
  );

drop policy if exists "audit_notes: firm insert" on public.audit_notes;
create policy "audit_notes: firm insert"
  on public.audit_notes for insert
  with check (
    exists (
      select 1 from public.audit_cases ac
      join public.firm_engagements e on e.id = ac.engagement_id
      where ac.id = audit_notes.audit_case_id
        and public.is_firm_member(e.firm_id)
    )
  );

drop policy if exists "audit_docs: firm read" on public.audit_documents;
create policy "audit_docs: firm read"
  on public.audit_documents for select
  using (
    exists (
      select 1 from public.audit_cases ac
      join public.firm_engagements e on e.id = ac.engagement_id
      where ac.id = audit_documents.audit_case_id
        and public.is_firm_member(e.firm_id)
    )
  );

drop policy if exists "audit_docs: firm insert" on public.audit_documents;
create policy "audit_docs: firm insert"
  on public.audit_documents for insert
  with check (
    exists (
      select 1 from public.audit_cases ac
      join public.firm_engagements e on e.id = ac.engagement_id
      where ac.id = audit_documents.audit_case_id
        and public.is_firm_member(e.firm_id)
    )
  );
