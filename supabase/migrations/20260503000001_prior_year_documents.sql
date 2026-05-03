-- Prior-year tax document store. Users upload their previous year's
-- W-2s, 1099s, Schedule C etc. We OCR them and use the totals as a
-- baseline for the current year's forecast.
--
-- Privacy posture: the file bytes themselves are NOT stored anywhere
-- (the extractor flows them through Anthropic and never persists). We
-- store only the structured extraction + a filename so the user can
-- recognize what they uploaded.

create type public.prior_doc_type as enum (
  'w2',
  '1099_nec',
  '1099_misc',
  '1099_k',
  '1099_div',
  '1099_int',
  '1099_r',
  '1099_g',
  'k1',
  'schedule_c',
  'form_1040',
  'unknown'
);

create table if not exists public.prior_year_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Company-scoped docs (Schedule C, business 1099s) get linked to a
  -- company. Personal docs (W-2, 1099-INT etc.) leave it null.
  company_id uuid references public.companies(id) on delete cascade,
  tax_year int not null,
  doc_type public.prior_doc_type not null,
  filename text,
  -- Full per-type structured extraction. The shape varies by
  -- doc_type so we keep it as JSONB rather than columns.
  extracted_data jsonb not null default '{}'::jsonb,
  confidence numeric,
  notes text,
  -- When we propagated this doc into monthly_income/monthly_expenses
  -- baselines. Null = uploaded but not yet applied.
  applied_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists prior_year_docs_user_year_idx
  on public.prior_year_documents (user_id, tax_year);
create index if not exists prior_year_docs_company_idx
  on public.prior_year_documents (company_id) where company_id is not null;

alter table public.prior_year_documents enable row level security;

create policy "prior_year_docs_owner_read"
  on public.prior_year_documents for select
  using (user_id = auth.uid());

create policy "prior_year_docs_owner_insert"
  on public.prior_year_documents for insert
  with check (user_id = auth.uid());

create policy "prior_year_docs_owner_update"
  on public.prior_year_documents for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "prior_year_docs_owner_delete"
  on public.prior_year_documents for delete
  using (user_id = auth.uid());

-- Track whether the user has been prompted for prior-year onboarding
-- so we don't nag them every time they hit /dashboard.
alter table public.profiles
  add column if not exists prior_year_prompt_dismissed_at timestamptz;
