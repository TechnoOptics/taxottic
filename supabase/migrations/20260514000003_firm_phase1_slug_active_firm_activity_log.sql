-- Phase 1 of the enterprise build-out. Three small schema additions
-- that unblock the firm cockpit + future subdomain routing + the
-- activity-feed scaffold every later phase will write to.
--
-- 1. firms.slug — the URL-safe handle used for {slug}.taxottic.com
--    routing in Phase 2. Wildcard-DNS work happens in Vercel + the
--    middleware; this column is the canonical mapping.
--
-- 2. profiles.active_firm_id — which firm the current user is acting
--    on inside the cockpit. Most preparers only belong to one firm,
--    in which case this stays NULL and the resolver defaults to the
--    earliest-joined firm. Power preparers who consult to multiple
--    firms (or super-admins) get a switcher in the UserMenu.
--
-- 3. firm_activity_log — append-only event stream that every firm
--    page writes to (client added, document uploaded, engagement
--    accepted, e-signature requested, payment received, etc.). The
--    real-time inbox in Phase 4 will subscribe via Supabase Realtime;
--    for Phase 1 we just need the table to start collecting events.

-- ----------------------------------------------------------------
-- 1. firms.slug
-- ----------------------------------------------------------------

alter table public.firms
  add column if not exists slug text;

-- Slug must match {a-z0-9-} and be 3-32 chars when set.
-- NULL is allowed so we can backfill existing rows in a follow-up
-- migration before flipping NOT NULL.
alter table public.firms
  drop constraint if exists firms_slug_format_check;
alter table public.firms
  add constraint firms_slug_format_check
  check (
    slug is null
    or (slug ~ '^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$' and char_length(slug) between 3 and 32)
  );

create unique index if not exists firms_slug_unique
  on public.firms (slug)
  where slug is not null;

-- ----------------------------------------------------------------
-- 2. profiles.active_firm_id
-- ----------------------------------------------------------------

alter table public.profiles
  add column if not exists active_firm_id uuid
  references public.firms(id) on delete set null;

create index if not exists profiles_active_firm_idx
  on public.profiles (active_firm_id)
  where active_firm_id is not null;

-- ----------------------------------------------------------------
-- 3. firm_activity_log
-- ----------------------------------------------------------------
--
-- Each row is one event. Keep the columns narrow + the JSON payload
-- generic so we don't have to ship a migration every time we add a
-- new event kind. RLS:
--   - firm owners + managers see everything for their firm
--   - preparers + reviewers see only events on engagements they're
--     assigned to (read via firm_engagements.assigned_preparer_id)
--   - clients see events on their own company (when they engage a
--     firm they want to see "Smith CPA opened your tax-prep packet"
--     — that comes from this table)

do $$ begin
  create type public.firm_activity_kind as enum (
    -- Client-side actions surfaced to the firm
    'client.company_created',
    'client.income_logged',
    'client.expense_logged',
    'client.bank_connected',
    'client.document_uploaded',
    'client.engagement_requested',
    'client.engagement_accepted',
    'client.message_sent',
    -- Firm-side actions surfaced to the client + audit trail
    'firm.engagement_created',
    'firm.engagement_accepted',
    'firm.engagement_completed',
    'firm.preparer_assigned',
    'firm.document_uploaded',
    'firm.document_signed',
    'firm.signature_requested',
    'firm.meeting_scheduled',
    'firm.invoice_sent',
    'firm.payment_received',
    'firm.tax_form_drafted',
    'firm.tax_form_filed',
    'firm.note_added',
    -- Admin / housekeeping
    'firm.member_invited',
    'firm.member_joined',
    'firm.member_removed'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.firm_activity_log (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  -- Optional company link: NULL for firm-level events
  -- (member invited, settings change, etc.); set for everything
  -- that pertains to a specific client.
  company_id uuid references public.companies(id) on delete set null,
  -- Optional engagement link: set when the event is tied to a
  -- specific tax-year engagement (most client-facing events are).
  engagement_id uuid references public.firm_engagements(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_side text not null check (actor_side in ('firm', 'client', 'system')),
  kind public.firm_activity_kind not null,
  -- Free-form payload. Keep small (a few keys). Examples:
  --   { "document_id": "...", "filename": "..." }
  --   { "amount_cents": 25000, "stripe_invoice_id": "..." }
  --   { "meeting_url": "...", "starts_at": "..." }
  payload jsonb not null default '{}'::jsonb,
  summary text,  -- pre-rendered human-language line for the feed
  created_at timestamptz not null default now()
);

create index if not exists firm_activity_log_firm_idx
  on public.firm_activity_log (firm_id, created_at desc);
create index if not exists firm_activity_log_company_idx
  on public.firm_activity_log (company_id, created_at desc)
  where company_id is not null;
create index if not exists firm_activity_log_engagement_idx
  on public.firm_activity_log (engagement_id, created_at desc)
  where engagement_id is not null;
create index if not exists firm_activity_log_kind_idx
  on public.firm_activity_log (firm_id, kind, created_at desc);

alter table public.firm_activity_log enable row level security;

-- Firm owners + managers see all events for their firm.
drop policy if exists "firm admins read all firm activity"
  on public.firm_activity_log;
create policy "firm admins read all firm activity"
  on public.firm_activity_log
  for select
  using (
    public.is_firm_owner_or_manager(firm_id)
    or public.is_super_admin()
  );

-- Preparers + reviewers see events on engagements assigned to them.
drop policy if exists "firm preparers read assigned engagement activity"
  on public.firm_activity_log;
create policy "firm preparers read assigned engagement activity"
  on public.firm_activity_log
  for select
  using (
    public.is_firm_member(firm_id)
    and engagement_id is not null
    and exists (
      select 1 from public.firm_engagements
      where id = firm_activity_log.engagement_id
        and assigned_preparer_id = auth.uid()
    )
  );

-- Clients (company managers) see events on their own company.
drop policy if exists "company manager reads activity on own company"
  on public.firm_activity_log;
create policy "company manager reads activity on own company"
  on public.firm_activity_log
  for select
  using (
    company_id is not null
    and public.is_company_manager(company_id)
  );

-- Writes go through a SECURITY DEFINER helper so the application
-- can't accidentally insert rows with the wrong firm/company/actor
-- combination. Direct INSERT is locked down to service-role only.

-- ----------------------------------------------------------------
-- log_firm_activity(...) — single ingress for activity writes.
-- ----------------------------------------------------------------
-- The helper enforces:
--   - actor_user_id matches auth.uid() (or NULL for system events)
--   - kind ∈ the enum
--   - firm_id is one the actor has a relationship with (member of
--     the firm OR manager of the company in question)
-- The application calls this from server actions / API routes,
-- which means the call site doesn't need its own RLS.
create or replace function public.log_firm_activity(
  p_firm_id uuid,
  p_company_id uuid,
  p_engagement_id uuid,
  p_kind public.firm_activity_kind,
  p_payload jsonb,
  p_summary text,
  p_actor_side text default 'firm'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
begin
  if p_firm_id is null then
    raise exception 'firm_id is required';
  end if;
  if p_actor_side not in ('firm', 'client', 'system') then
    raise exception 'invalid actor_side: %', p_actor_side;
  end if;
  -- Permission gate: actor must either belong to the firm OR be a
  -- manager of the company OR be the system itself (service role
  -- bypasses RLS but we still enforce here for defense in depth).
  if v_actor is not null then
    if not (
      public.is_firm_member(p_firm_id)
      or (p_company_id is not null and public.is_company_manager(p_company_id))
      or public.is_super_admin()
    ) then
      raise exception 'not authorized to log activity for firm %', p_firm_id;
    end if;
  end if;
  insert into public.firm_activity_log(
    firm_id, company_id, engagement_id, actor_user_id, actor_side, kind, payload, summary
  ) values (
    p_firm_id, p_company_id, p_engagement_id, v_actor, p_actor_side, p_kind, coalesce(p_payload, '{}'::jsonb), p_summary
  )
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.log_firm_activity(uuid, uuid, uuid, public.firm_activity_kind, jsonb, text, text)
  to authenticated;
