-- Phase 11.7: e-filing scaffold.
--
-- Every submission to a taxing authority — federal IRS, state DOR,
-- 1099 transmittals, payroll filings — gets one row in
-- `firm_efilings`. The row tracks:
--   - what was filed (form type + tax year + period for quarterly
--     filings)
--   - to whom (federal vs state, IRS service center, state code)
--   - the submission packet (the PDF that went out, or the MeF XML
--     for direct e-file)
--   - the lifecycle status: prepared → submitted → accepted /
--     rejected
--   - the IRS acknowledgment payload when received
--
-- We deliberately ship the data model + status-tracking UI in v1
-- without the actual MeF XML / submission integration. Direct IRS
-- e-file requires an EFIN application + IRS testing + per-form XSD
-- compliance + a Modernized e-File (MeF) provider relationship —
-- multiple weeks of compliance work that's better staffed once a
-- pilot firm has actual returns to file. Until then the firm:
--   1. Generates the document via Phase 11.5.
--   2. Reviews + downloads the PDF (Phase 11.6).
--   3. Files via the IRS portal or a partner ERO.
--   4. Records the result here as 'submitted' or 'accepted'.
--
-- When we wire MeF, the same row picks up the actual provider
-- IDs + acknowledgment XML in the same columns.

do $$ begin
  create type public.firm_efiling_form as enum (
    'form_1040',        -- Individual return + Schedule C/E/F/SE
    'form_1040_x',      -- Amended return
    'form_1065',        -- Partnership return
    'form_1120',        -- C-Corp return
    'form_1120_s',      -- S-Corp return
    'form_990',         -- Tax-exempt
    'form_941',         -- Quarterly payroll
    'form_944',         -- Annual small-employer payroll
    'form_940',         -- FUTA
    'form_w2',          -- W-2 batch (SSA, not IRS)
    'form_1099_nec',    -- 1099-NEC batch
    'form_1099_misc',   -- 1099-MISC batch
    'state_income',     -- Catch-all state income return
    'state_sales_tax',  -- State sales tax return
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.firm_efiling_status as enum (
    'prepared',         -- Document drafted, not submitted
    'queued',           -- Marked for batch submission
    'submitted',        -- Sent to authority (IRS portal, ERO, MeF)
    'accepted',         -- Authority acknowledged receipt + accepted
    'rejected',         -- Authority rejected; see reject_reason
    'amended',          -- Replaced by an amended return
    'cancelled'         -- Voided before submission
  );
exception when duplicate_object then null; end $$;

create table if not exists public.firm_efilings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  engagement_id uuid references public.firm_engagements(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  -- The document row that backs this filing — the PDF that was
  -- submitted. NULL only when the firm recorded a filing for
  -- which they don't have a stored document.
  document_id uuid references public.firm_documents(id) on delete set null,
  form public.firm_efiling_form not null,
  tax_year int not null,
  -- Period — only set for quarterly / monthly filings. ISO date
  -- representing the period-end (e.g., 2026-03-31 for Q1 941).
  period_end date,
  -- Federal vs state. For state filings, store the state code
  -- (CA, NY, etc.); for federal, NULL.
  jurisdiction text not null
    check (jurisdiction = 'federal' or length(jurisdiction) = 2),
  status public.firm_efiling_status not null default 'prepared',
  -- IRS service center / state DOR identifier; varies by form.
  submission_target text,
  -- Provider-side submission ID (MeF declaration control number,
  -- ERO acknowledgment number, manual reference).
  provider_submission_id text,
  submitted_at timestamptz,
  accepted_at timestamptz,
  rejected_at timestamptz,
  reject_reason text,
  -- IRS acknowledgment XML or response body, kept for audit.
  acknowledgment_payload jsonb,
  -- Preparer signing the return.
  preparer_user_id uuid references public.profiles(id) on delete set null,
  preparer_ptin text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists firm_efilings_firm_idx
  on public.firm_efilings (firm_id, created_at desc);
create index if not exists firm_efilings_engagement_idx
  on public.firm_efilings (engagement_id, tax_year, form)
  where engagement_id is not null;
create index if not exists firm_efilings_status_idx
  on public.firm_efilings (firm_id, status, created_at desc);

alter table public.firm_efilings enable row level security;

-- Firm admins read all firm filings.
drop policy if exists "firm admins read all efilings"
  on public.firm_efilings;
create policy "firm admins read all efilings"
  on public.firm_efilings
  for select
  using (
    public.is_firm_owner_or_manager(firm_id)
    or public.is_super_admin()
  );

-- Preparers read efilings on engagements assigned to them.
drop policy if exists "firm preparers read assigned efilings"
  on public.firm_efilings;
create policy "firm preparers read assigned efilings"
  on public.firm_efilings
  for select
  using (
    public.is_firm_member(firm_id)
    and engagement_id is not null
    and exists (
      select 1 from public.firm_engagements
      where id = firm_efilings.engagement_id
        and assigned_preparer_id = auth.uid()
    )
  );

-- Clients read their own company's efilings — once the firm marks
-- something accepted by the IRS, the client should see it on their
-- preparer page.
drop policy if exists "client reads own company efilings"
  on public.firm_efilings;
create policy "client reads own company efilings"
  on public.firm_efilings
  for select
  using (
    company_id is not null
    and public.is_company_manager(company_id)
  );

drop policy if exists "firm members create efilings"
  on public.firm_efilings;
create policy "firm members create efilings"
  on public.firm_efilings
  for insert
  with check (public.is_firm_member(firm_id));

drop policy if exists "firm owners update efilings"
  on public.firm_efilings;
create policy "firm owners update efilings"
  on public.firm_efilings
  for update
  using (public.is_firm_owner_or_manager(firm_id));

create or replace function public.firm_efilings_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists firm_efilings_touch on public.firm_efilings;
create trigger firm_efilings_touch
  before update on public.firm_efilings
  for each row execute function public.firm_efilings_touch_updated_at();

do $$ begin
  alter publication supabase_realtime add table public.firm_efilings;
exception when others then null; end $$;
