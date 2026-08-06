-- Recovered 20260430011227 (enterprise_part2_engagements_audits) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Engagement: a firm-client relationship for a tax year. Created
-- when the client (or their manager) requests the firm as preparer,
-- or the firm sends an invite the client accepts. status='active'
-- is what unlocks RLS read access on that client's books.

do $$ begin
  create type public.engagement_status as enum (
    'pending_firm',     -- client requested, firm hasn't accepted
    'pending_client',   -- firm reached out, client hasn't accepted
    'active',
    'completed',
    'declined',
    'terminated'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.engagement_kind as enum (
    'tax_prep',         -- preparing a return
    'audit_support',    -- representing during an exam
    'bookkeeping',      -- ongoing books
    'advisory'          -- general advisory
  );
exception when duplicate_object then null; end $$;

create table if not exists public.firm_engagements (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  tax_year int not null,
  kind public.engagement_kind not null default 'tax_prep',
  status public.engagement_status not null default 'pending_firm',
  -- Who initiated: the client manager or someone at the firm
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
  -- One active engagement per (firm, company, tax_year, kind).
  unique (firm_id, company_id, tax_year, kind)
);

create index if not exists firm_engagements_firm_idx
  on public.firm_engagements (firm_id, status, tax_year);
create index if not exists firm_engagements_company_idx
  on public.firm_engagements (company_id, status);

-- Audits / IRS examinations workflow
do $$ begin
  create type public.audit_status as enum (
    'open',          -- intake; reviewing the notice
    'responding',    -- preparing or in dialogue with IRS
    'closed_resolved',
    'closed_no_change',
    'closed_other'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.audit_cases (
  id uuid primary key default gen_random_uuid(),
  engagement_id uuid not null references public.firm_engagements(id) on delete cascade,
  tax_year int not null,
  notice_kind text,                       -- e.g., CP2000, CP504, Letter 525
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

-- Audit work log: timestamped notes the firm builds up while
-- responding to the IRS. Mostly admin notes for their own audit trail.
create table if not exists public.audit_notes (
  id uuid primary key default gen_random_uuid(),
  audit_case_id uuid not null references public.audit_cases(id) on delete cascade,
  body text not null,
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists audit_notes_case_idx
  on public.audit_notes (audit_case_id, created_at desc);

-- Audit documents: scanned IRS letters, supporting docs, response
-- drafts. Bytes live in a private storage bucket; this table holds
-- metadata.
create table if not exists public.audit_documents (
  id uuid primary key default gen_random_uuid(),
  audit_case_id uuid not null references public.audit_cases(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 0 and 52428800), -- 50 MB
  kind text,                              -- e.g., 'irs_notice', 'response', 'supporting'
  uploaded_by uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);

create index if not exists audit_documents_case_idx
  on public.audit_documents (audit_case_id, uploaded_at desc);
