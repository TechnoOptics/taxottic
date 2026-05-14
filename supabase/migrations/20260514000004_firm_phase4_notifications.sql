-- Phase 4 of the enterprise build: in-app inbox + per-user read
-- state + notification preferences + digest cron.
--
-- Two tables:
--   1. firm_activity_reads — per-user cursor into firm_activity_log.
--      We store `last_read_at` rather than per-row read flags so the
--      unread count is a cheap `WHERE created_at > last_read_at`
--      query and writes only happen when the user actively marks
--      the inbox read.
--   2. firm_notification_preferences — opt-in/out for digest cadence
--      and which event kinds the user wants surfaced. Sane defaults
--      live in the application so unconfigured users get the right
--      experience without forcing a profile setup step.

-- ----------------------------------------------------------------
-- firm_activity_reads
-- ----------------------------------------------------------------

create table if not exists public.firm_activity_reads (
  user_id uuid not null references public.profiles(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  -- For tracking when the user last *opened* the inbox vs when we
  -- last *sent* a digest — different concerns, both useful.
  last_digest_sent_at timestamptz,
  primary key (user_id, firm_id)
);

alter table public.firm_activity_reads enable row level security;

drop policy if exists "user reads own activity-reads"
  on public.firm_activity_reads;
create policy "user reads own activity-reads"
  on public.firm_activity_reads
  for select
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "user upserts own activity-reads"
  on public.firm_activity_reads;
create policy "user upserts own activity-reads"
  on public.firm_activity_reads
  for insert
  with check (user_id = auth.uid());

drop policy if exists "user updates own activity-reads"
  on public.firm_activity_reads;
create policy "user updates own activity-reads"
  on public.firm_activity_reads
  for update
  using (user_id = auth.uid());

-- ----------------------------------------------------------------
-- firm_notification_preferences
-- ----------------------------------------------------------------

do $$ begin
  create type public.firm_digest_cadence as enum (
    'off',
    'daily',
    'weekly'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.firm_notification_preferences (
  user_id uuid not null references public.profiles(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  digest_cadence public.firm_digest_cadence not null default 'daily',
  -- Hour-of-day in user's local TZ when the digest goes out (24h).
  -- Hard-coding to UTC for now; per-user TZ lands when we capture it.
  digest_hour_utc int not null default 13 check (digest_hour_utc between 0 and 23),
  -- Which activity-kind buckets to include. NULL = all enabled.
  -- We don't ship every event in the digest — only ones a firm
  -- partner actually wants to see in their morning email (clients
  -- doing something, engagements changing state, payments coming
  -- in). The application enforces the "interesting kinds" list;
  -- this column is for user-level opt-outs of any subset.
  excluded_kinds text[] not null default '{}',
  primary key (user_id, firm_id)
);

alter table public.firm_notification_preferences enable row level security;

drop policy if exists "user reads own notif prefs"
  on public.firm_notification_preferences;
create policy "user reads own notif prefs"
  on public.firm_notification_preferences
  for select
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "user upserts own notif prefs"
  on public.firm_notification_preferences;
create policy "user upserts own notif prefs"
  on public.firm_notification_preferences
  for insert
  with check (user_id = auth.uid());

drop policy if exists "user updates own notif prefs"
  on public.firm_notification_preferences;
create policy "user updates own notif prefs"
  on public.firm_notification_preferences
  for update
  using (user_id = auth.uid());

-- ----------------------------------------------------------------
-- Helpers
-- ----------------------------------------------------------------

-- unread_firm_activity_count — fast cheap call for the header badge.
-- Cap at 50 so we don't render "1,247 unread" which reads as
-- failure mode rather than signal.
create or replace function public.unread_firm_activity_count(p_firm_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  with read_cursor as (
    select coalesce(last_read_at, '1970-01-01'::timestamptz) as cursor
    from public.firm_activity_reads
    where user_id = auth.uid() and firm_id = p_firm_id
  )
  select least(
    50,
    (
      select count(*)::int
      from public.firm_activity_log
      where firm_id = p_firm_id
        and created_at > coalesce(
          (select cursor from read_cursor),
          '1970-01-01'::timestamptz
        )
    )
  );
$$;

grant execute on function public.unread_firm_activity_count(uuid) to authenticated;

-- mark_firm_activity_read — bumps the cursor to now(). The inbox
-- page calls this when the user opens it.
create or replace function public.mark_firm_activity_read(p_firm_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  insert into public.firm_activity_reads(user_id, firm_id, last_read_at)
  values (auth.uid(), p_firm_id, now())
  on conflict (user_id, firm_id) do update
    set last_read_at = now();
end;
$$;

grant execute on function public.mark_firm_activity_read(uuid) to authenticated;

-- Subscribe firm_activity_log to Supabase Realtime so the inbox
-- updates live. We already publish the table to the consumer-facing
-- channels; this `add table` is idempotent.
do $$ begin
  alter publication supabase_realtime add table public.firm_activity_log;
exception when others then null; end $$;
