-- Recovered 20260515005204 (firm_document_versions) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.firm_document_versions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.firm_documents(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  version int not null,
  storage_path text not null,
  filename text not null,
  content_type text not null,
  size_bytes bigint default 0,
  sha256 text,
  kind public.firm_document_kind not null,
  status public.firm_document_status not null,
  provider public.firm_document_provider,
  provider_envelope_id text,
  notes text,
  versioned_by uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  unique (document_id, version)
);

create index if not exists firm_document_versions_doc_idx on public.firm_document_versions (document_id, version desc);
create index if not exists firm_document_versions_firm_idx on public.firm_document_versions (firm_id, created_at desc);

alter table public.firm_document_versions enable row level security;

drop policy if exists "firm admins read all doc versions" on public.firm_document_versions;
create policy "firm admins read all doc versions" on public.firm_document_versions for select
  using (public.is_firm_owner_or_manager(firm_id) or public.is_super_admin());

drop policy if exists "firm preparers read assigned doc versions" on public.firm_document_versions;
create policy "firm preparers read assigned doc versions" on public.firm_document_versions for select
  using (public.is_firm_member(firm_id) and exists (
    select 1 from public.firm_documents d
    join public.firm_engagements e on e.id = d.engagement_id
    where d.id = firm_document_versions.document_id and e.assigned_preparer_id = auth.uid()
  ));

drop policy if exists "client reads versions of own company docs" on public.firm_document_versions;
create policy "client reads versions of own company docs" on public.firm_document_versions for select
  using (exists (
    select 1 from public.firm_documents d
    where d.id = firm_document_versions.document_id and d.company_id is not null and public.is_company_manager(d.company_id)
  ));

create or replace function public.snapshot_firm_document(p_document_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare d public.firm_documents%rowtype; v_next int; v_id uuid;
begin
  if auth.uid() is null then raise exception 'auth_required'; end if;
  select * into d from public.firm_documents where id = p_document_id;
  if not found then raise exception 'document_not_found'; end if;
  if not (public.is_firm_member(d.firm_id) or (d.company_id is not null and public.is_company_manager(d.company_id)) or public.is_super_admin()) then
    raise exception 'not_authorized';
  end if;
  select coalesce(max(version), 0) + 1 into v_next from public.firm_document_versions where document_id = p_document_id;
  insert into public.firm_document_versions(
    document_id, firm_id, version, storage_path, filename, content_type, size_bytes, sha256,
    kind, status, provider, provider_envelope_id, notes, versioned_by, reason
  ) values (
    p_document_id, d.firm_id, v_next, d.storage_path, d.filename, d.content_type, d.size_bytes, d.sha256,
    d.kind, d.status, d.provider, d.provider_envelope_id, d.notes, auth.uid(), p_reason
  ) returning id into v_id;
  return v_id;
end;
$fn$;

grant execute on function public.snapshot_firm_document(uuid, text) to authenticated;
