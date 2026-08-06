-- Recovered 20260515004827 (firm_phase5_documents) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

do $$ begin
  create type public.firm_document_kind as enum (
    'engagement_letter','organizer','invoice','receipt','firm_letter','internal_memo',
    'schedule_c_draft','schedule_e_draft','k1_draft','1099_nec_draft','1099_misc_draft','1040_draft','tax_return_packet',
    'client_upload_w2','client_upload_1099','client_upload_receipt','client_upload_prior_return','client_upload_other',
    'manual_upload'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.firm_document_status as enum ('draft','ready_for_review','awaiting_signature','signed','filed','sent_to_client','archived','error');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.firm_document_provider as enum ('manual','generated','documenso','docusign');
exception when duplicate_object then null; end $$;

create table if not exists public.firm_documents (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  engagement_id uuid references public.firm_engagements(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  uploader_user_id uuid references public.profiles(id) on delete set null,
  kind public.firm_document_kind not null,
  status public.firm_document_status not null default 'draft',
  provider public.firm_document_provider not null default 'manual',
  provider_envelope_id text,
  storage_path text not null,
  filename text not null,
  content_type text not null default 'application/pdf',
  size_bytes bigint default 0,
  tax_year int,
  notes text,
  sha256 text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  signed_at timestamptz,
  filed_at timestamptz
);

create index if not exists firm_documents_firm_idx on public.firm_documents (firm_id, created_at desc);
create index if not exists firm_documents_engagement_idx on public.firm_documents (engagement_id, created_at desc) where engagement_id is not null;
create index if not exists firm_documents_company_idx on public.firm_documents (company_id, created_at desc) where company_id is not null;
create index if not exists firm_documents_envelope_idx on public.firm_documents (provider, provider_envelope_id) where provider_envelope_id is not null;
create index if not exists firm_documents_status_idx on public.firm_documents (firm_id, status, created_at desc);

alter table public.firm_documents enable row level security;

drop policy if exists "firm admins read all firm documents" on public.firm_documents;
create policy "firm admins read all firm documents" on public.firm_documents for select
  using (public.is_firm_owner_or_manager(firm_id) or public.is_super_admin());

drop policy if exists "firm preparers read assigned engagement docs" on public.firm_documents;
create policy "firm preparers read assigned engagement docs" on public.firm_documents for select
  using (public.is_firm_member(firm_id) and engagement_id is not null
    and exists (select 1 from public.firm_engagements where id = firm_documents.engagement_id and assigned_preparer_id = auth.uid()));

drop policy if exists "client reads own company docs" on public.firm_documents;
create policy "client reads own company docs" on public.firm_documents for select
  using (company_id is not null and public.is_company_manager(company_id));

drop policy if exists "firm members insert firm docs" on public.firm_documents;
create policy "firm members insert firm docs" on public.firm_documents for insert
  with check (public.is_firm_member(firm_id) or (company_id is not null and public.is_company_manager(company_id)));

drop policy if exists "firm members update firm docs" on public.firm_documents;
create policy "firm members update firm docs" on public.firm_documents for update
  using (public.is_firm_owner_or_manager(firm_id) or (company_id is not null and public.is_company_manager(company_id)));

create or replace function public.firm_documents_touch_updated_at()
returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end;
$fn$;

drop trigger if exists firm_documents_touch_updated_at on public.firm_documents;
create trigger firm_documents_touch_updated_at before update on public.firm_documents
  for each row execute function public.firm_documents_touch_updated_at();

do $$ begin
  alter publication supabase_realtime add table public.firm_documents;
exception when others then null; end $$;
