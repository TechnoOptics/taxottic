-- Phase 6 of the enterprise build: scheduling.
--
-- Three tables. Two enums. Per-user OAuth tokens kept ENCRYPTED at
-- rest (the column type is text but we'll envelope-encrypt the
-- token blob via the same pgsodium pattern bank_connection_secrets
-- uses — see encryption migration in Phase 6.5 if/when we wire
-- real OAuth grants).
--
-- For Phase 6 v1 the OAuth grant routes live on the firm side
-- ("Connect your Zoom account") but the table accepts manual
-- meeting entry as well, so a preparer who hasn't connected
-- anything can still record a meeting they scheduled offline.
-- Provider-specific link generation requires the OAuth token.

-- ----------------------------------------------------------------
-- firm_calendar_integrations
-- ----------------------------------------------------------------

do $$ begin
  create type public.firm_calendar_provider as enum (
    'google',
    'microsoft',
    'zoom'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.firm_calendar_integrations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  provider public.firm_calendar_provider not null,
  -- Account identifier on the provider side (their email,
  -- usually). Helps the UI confirm "you're connected as
  -- prep@firm.com" without re-decrypting the token.
  provider_account_email text,
  provider_account_id text,
  -- Encrypted token JSON. The application reads + decrypts via
  -- the helper in lib/firm/scheduling/secrets.ts (Phase 6.5).
  encrypted_token_blob text,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  refreshed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (firm_id, user_id, provider, provider_account_id)
);

create index if not exists firm_calendar_integrations_user_idx
  on public.firm_calendar_integrations (user_id, provider);

alter table public.firm_calendar_integrations enable row level security;

drop policy if exists "user reads own calendar integrations"
  on public.firm_calendar_integrations;
create policy "user reads own calendar integrations"
  on public.firm_calendar_integrations
  for select
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "user manages own calendar integrations"
  on public.firm_calendar_integrations;
create policy "user manages own calendar integrations"
  on public.firm_calendar_integrations
  for insert
  with check (user_id = auth.uid());

drop policy if exists "user updates own calendar integrations"
  on public.firm_calendar_integrations;
create policy "user updates own calendar integrations"
  on public.firm_calendar_integrations
  for update
  using (user_id = auth.uid());

drop policy if exists "user deletes own calendar integrations"
  on public.firm_calendar_integrations;
create policy "user deletes own calendar integrations"
  on public.firm_calendar_integrations
  for delete
  using (user_id = auth.uid());

-- ----------------------------------------------------------------
-- firm_meetings
-- ----------------------------------------------------------------

do $$ begin
  create type public.firm_meeting_kind as enum (
    'intro',
    'planning',
    'review',
    'signing',
    'training',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.firm_meeting_status as enum (
    'scheduled',
    'rescheduled',
    'completed',
    'cancelled',
    'no_show'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.firm_meetings (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  engagement_id uuid references public.firm_engagements(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  organizer_user_id uuid references public.profiles(id) on delete set null,
  client_email text,
  client_name text,
  kind public.firm_meeting_kind not null default 'planning',
  status public.firm_meeting_status not null default 'scheduled',
  -- When the meeting starts + how long. ISO-8601 + minutes.
  starts_at timestamptz not null,
  duration_minutes int not null default 30 check (duration_minutes > 0),
  -- Provider that hosts the meeting; NULL when offline.
  provider public.firm_calendar_provider,
  provider_event_id text,
  meeting_url text,
  agenda text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancel_reason text
);

create index if not exists firm_meetings_firm_idx
  on public.firm_meetings (firm_id, starts_at desc);
create index if not exists firm_meetings_engagement_idx
  on public.firm_meetings (engagement_id, starts_at desc)
  where engagement_id is not null;
create index if not exists firm_meetings_organizer_idx
  on public.firm_meetings (organizer_user_id, starts_at desc);

alter table public.firm_meetings enable row level security;

drop policy if exists "firm members read firm meetings"
  on public.firm_meetings;
create policy "firm members read firm meetings"
  on public.firm_meetings
  for select
  using (
    public.is_firm_member(firm_id)
    or (company_id is not null and public.is_company_manager(company_id))
    or public.is_super_admin()
  );

drop policy if exists "firm members create firm meetings"
  on public.firm_meetings;
create policy "firm members create firm meetings"
  on public.firm_meetings
  for insert
  with check (public.is_firm_member(firm_id));

drop policy if exists "firm members update firm meetings"
  on public.firm_meetings;
create policy "firm members update firm meetings"
  on public.firm_meetings
  for update
  using (public.is_firm_member(firm_id));

create or replace function public.firm_meetings_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;
drop trigger if exists firm_meetings_touch_updated_at on public.firm_meetings;
create trigger firm_meetings_touch_updated_at
  before update on public.firm_meetings
  for each row execute function public.firm_meetings_touch_updated_at();

-- ----------------------------------------------------------------
-- firm_availability_rules — per-preparer recurring availability
-- ----------------------------------------------------------------

create table if not exists public.firm_availability_rules (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- 0=Sunday .. 6=Saturday (matches Date.prototype.getDay)
  day_of_week int not null check (day_of_week between 0 and 6),
  -- HH:MM in 24h, UTC. 13:00 = 9am ET / 6am PT.
  starts_at_utc time not null,
  ends_at_utc time not null,
  created_at timestamptz not null default now(),
  check (starts_at_utc < ends_at_utc)
);

create index if not exists firm_availability_rules_user_idx
  on public.firm_availability_rules (user_id, day_of_week);

alter table public.firm_availability_rules enable row level security;

drop policy if exists "user reads availability rules"
  on public.firm_availability_rules;
create policy "user reads availability rules"
  on public.firm_availability_rules
  for select
  using (
    user_id = auth.uid()
    or public.is_firm_member(firm_id)
    or public.is_super_admin()
  );

drop policy if exists "user manages own availability"
  on public.firm_availability_rules;
create policy "user manages own availability"
  on public.firm_availability_rules
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Realtime: meetings table updates the per-engagement panel + the
-- preparer's day view.
do $$ begin
  alter publication supabase_realtime add table public.firm_meetings;
exception when others then null; end $$;
