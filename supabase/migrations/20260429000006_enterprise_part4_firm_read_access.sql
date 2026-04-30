-- Firms with an ACTIVE engagement get read-only access to the
-- linked customer's books. Each existing client-owned table gets a
-- parallel SELECT policy via firm_has_active_engagement_with.

drop policy if exists "companies: firm engaged read" on public.companies;
create policy "companies: firm engaged read"
  on public.companies for select
  using (public.firm_has_active_engagement_with(id));

drop policy if exists "business_profiles: firm engaged read" on public.business_profiles;
create policy "business_profiles: firm engaged read"
  on public.business_profiles for select
  using (public.firm_has_active_engagement_with(company_id));

drop policy if exists "monthly_income: firm engaged read" on public.monthly_income;
create policy "monthly_income: firm engaged read"
  on public.monthly_income for select
  using (public.firm_has_active_engagement_with(company_id));

drop policy if exists "monthly_expenses: firm engaged read" on public.monthly_expenses;
create policy "monthly_expenses: firm engaged read"
  on public.monthly_expenses for select
  using (public.firm_has_active_engagement_with(company_id));

drop policy if exists "tax_profiles: firm engaged read" on public.tax_profiles;
create policy "tax_profiles: firm engaged read"
  on public.tax_profiles for select
  using (
    exists (
      select 1
      from public.firm_engagements e
      join public.firm_members fm on fm.firm_id = e.firm_id
      join public.company_members cm on cm.company_id = e.company_id
      where e.status = 'active'
        and fm.user_id = auth.uid()
        and cm.user_id = tax_profiles.user_id
        and cm.role = 'manager'
        and tax_profiles.tax_year = e.tax_year
    )
  );

-- Audit document storage bucket
insert into storage.buckets (id, name, public)
values ('audit-documents', 'audit-documents', false)
on conflict (id) do nothing;

drop policy if exists "audit-docs: firm read" on storage.objects;
create policy "audit-docs: firm read"
  on storage.objects for select
  using (
    bucket_id = 'audit-documents'
    and exists (
      select 1
      from public.firms f
      join public.audit_cases ac on ac.id::text = (storage.foldername(storage.objects.name))[2]
      join public.firm_engagements e on e.id = ac.engagement_id and e.firm_id = f.id
      where f.public_id = (storage.foldername(storage.objects.name))[1]
        and public.is_firm_member(f.id)
    )
  );

drop policy if exists "audit-docs: firm insert" on storage.objects;
create policy "audit-docs: firm insert"
  on storage.objects for insert
  with check (
    bucket_id = 'audit-documents'
    and exists (
      select 1
      from public.firms f
      join public.audit_cases ac on ac.id::text = (storage.foldername(storage.objects.name))[2]
      join public.firm_engagements e on e.id = ac.engagement_id and e.firm_id = f.id
      where f.public_id = (storage.foldername(storage.objects.name))[1]
        and public.is_firm_member(f.id)
    )
  );

drop policy if exists "audit-docs: firm delete" on storage.objects;
create policy "audit-docs: firm delete"
  on storage.objects for delete
  using (
    bucket_id = 'audit-documents'
    and (owner = auth.uid() or exists (
      select 1
      from public.firms f
      where f.public_id = (storage.foldername(storage.objects.name))[1]
        and public.is_firm_owner_or_manager(f.id)
    ))
  );

do $$ begin
  alter publication supabase_realtime add table public.firm_engagements;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.audit_cases;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.audit_notes;
exception when others then null; end $$;
