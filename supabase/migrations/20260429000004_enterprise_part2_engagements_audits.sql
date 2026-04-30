-- Engagements (firm-client relationship) + audit case workflow.

do $$ begin
  create type public.engagement_status as enum (
    'pending_firm',
    'pending_client',
    'active',
    'completed',
    'declined',
    'terminated'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.engagement_kind as enum (
    'tax_prep',
    'audit_support',
    'bookkeeping',
    'advisory'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.firm_engagements (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  tax_year int not null,
  kind public.engagement_kind not null default 'tax_prep',
  status public.engagement_status not null default 'pending_firm',
  requested_by uuid references auth.users(id) on delete set null,
  requested_by_side text not null
    check (requested_by_side in ('client', 'firm')),
  assigned_preparer_id uuid references auth.users(id) on delete set null,
  scope_summary text,
  client_note text,
  firm_note text,
  requested_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by uuid references auth.users(id) on delete set null,
  ended_at timestamptz,
  unique (firm_id, company_id, tax_year, kind)
);

create index if not exists firm_engagements_firm_idx
  on public.firm_engagements (firm_id, status, tax_year);
create index if not exists firm_engagements_company_idx
  on public.firm_engagements (company_id, status);

do $$ begin
  create type public.audit_status as enum (
    'open',
    'responding',
    'closed_resolved',
    'closed_no_change',
    'closed_other'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.audit_cases (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.firm_engagements(id) on delete cascade,
  tax_year int not null,
  notice_kind text,
  notice_received_at date,
  response_due_at date,
  status public.audit_status not null default 'open',
  summary text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_outcome text
);

create index if not exists audit_cases_engagement_idx
  on public.audit_cases (engagement_id, status);

create table if not exists public.audit_notes (
  id uuid primary key default gen_random_uuid(),
  audit_case_id uuid not null references public.audit_cases(id) on delete cascade,
  body text not null,
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists audit_notes_case_idx
  on public.audit_notes (audit_case_id, created_at desc);

create table if not exists public.audit_documents (
  id uuid primary key default gen_random_uuid(),
  audit_case_id uuid not null references public.audit_cases(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 0 and 52428800),
  kind text,
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create index if not exists audit_documents_case_idx
  on public.audit_documents (audit_case_id, uploaded_at desc);
