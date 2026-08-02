-- Multi-signal confidence engine: storage.
--
-- PURELY ADDITIVE. New tables, new nullable columns, new indexes. No
-- column is altered or dropped, and there is no UPDATE or DELETE against
-- any production row. Existing trips keep NULL confidence, which the
-- scorer reads as "never evaluated" and therefore leaves alone: a
-- backfill would restate history the user has already seen, and on a tax
-- record that is worse than an unanswered question.
--
-- NOT APPLIED TO PRODUCTION. Submitted for review.

-- ── 1. Per-trip confidence ──────────────────────────────────────────
--
-- Why store the score and not just the verdict: this is a tax record.
-- When a driver asks in March why a January drive was not deducted, the
-- answer has to be reconstructible from the row, not from a log that
-- has rotated.
alter table public.mileage_trips
  add column if not exists confidence_score numeric(6,2),
  add column if not exists confidence_tier text,
  add column if not exists confidence_reasons jsonb,
  add column if not exists confidence_signals jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'mileage_trips_confidence_tier_check'
  ) then
    alter table public.mileage_trips
      add constraint mileage_trips_confidence_tier_check
      check (confidence_tier is null or confidence_tier in
        ('high', 'needs_review', 'insufficient', 'unevaluated'));
  end if;
end $$;

comment on column public.mileage_trips.confidence_score is
  'Weighted multi-signal evidence score at finalize, roughly -100..100. NULL = scored before this column existed, or never scored. Advisory: needs_confirmation is what actually gates the deduction.';
comment on column public.mileage_trips.confidence_tier is
  'high | needs_review | insufficient | unevaluated. "unevaluated" means no signal was readable and NOTHING was inferred from that: absence of evidence is not evidence of absence.';
comment on column public.mileage_trips.confidence_reasons is
  'Plain-language sentences shown on the review card, e.g. ["No car connection detected"]. Written for the driver, not for logs.';
comment on column public.mileage_trips.confidence_signals is
  'Audit trail: which signals contributed, their age and their decayed weight. The evidence behind a deduction has to survive as long as the deduction does.';

-- ── 2. Timestamped signal events from the native producers ──────────
--
-- One row per observed INTERVAL, not per instant: a car link that is
-- still up is present-tense evidence and must not age, while one that
-- dropped ten minutes ago must. `source` is deliberately preserved and
-- never collapsed: a poll ("we looked and it was connected") is not a
-- transition ("it just connected"), and treating them alike lets a car
-- parked all evening with the accessories on read as a fresh trip start.
create table if not exists public.mileage_signal_events (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null,
  platform text not null,
  started_at timestamptz not null,
  last_seen_at timestamptz not null,
  ended_at timestamptz,
  -- 0..1. Graded evidence (how long speed held, CoreMotion's own
  -- confidence) and the poll-provenance discount both land here.
  strength numeric(4,3),
  source text,
  detail text,
  created_at timestamptz not null default now(),
  -- Idempotent re-post, matching the raw-points contract: a producer
  -- that retries a flush must not multiply its own evidence.
  unique (driver_user_id, company_id, kind, started_at)
);

create index if not exists mileage_signal_events_window_idx
  on public.mileage_signal_events (driver_user_id, company_id, started_at desc);

alter table public.mileage_signal_events enable row level security;

-- Drivers may read their own signal history; nothing writes through the
-- anon key. Ingest runs service-role, exactly like mileage_learned_places.
drop policy if exists mileage_signal_events_select_own on public.mileage_signal_events;
create policy mileage_signal_events_select_own
  on public.mileage_signal_events for select
  using (driver_user_id = auth.uid());

comment on table public.mileage_signal_events is
  'Timestamped vehicle-presence and motion observations from the native producers, consumed by the confidence engine at finalize. Confirmation-tier evidence only: nothing here may start a trip, because none of it can start our process.';

-- ── 3. Detected capture gaps ────────────────────────────────────────
--
-- The OS can tell us we were driving during a window we captured
-- nothing for. It cannot tell us WHERE, because there is no location in
-- motion history. So a gap is reported and never filled: duration only,
-- no distance, no route, no deduction. A fabricated business mile is
-- worse than a missing one.
create table if not exists public.mileage_capture_gaps (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  from_at timestamptz not null,
  to_at timestamptz not null,
  gap_ms bigint not null,
  -- Automotive time the OS recorded inside the gap. Zero means the
  -- device was simply off and nothing was missed.
  automotive_ms bigint not null default 0,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (driver_user_id, company_id, from_at)
);

create index if not exists mileage_capture_gaps_driver_idx
  on public.mileage_capture_gaps (driver_user_id, company_id, from_at desc);

alter table public.mileage_capture_gaps enable row level security;

drop policy if exists mileage_capture_gaps_select_own on public.mileage_capture_gaps;
create policy mileage_capture_gaps_select_own
  on public.mileage_capture_gaps for select
  using (driver_user_id = auth.uid());

comment on table public.mileage_capture_gaps is
  'Windows the OS says we were driving and captured nothing. Duration only, never distance: motion history carries no location. Surfaced so the driver can add the drive, never auto-filled.';

-- ── 4. Signal availability on the device record ─────────────────────
--
-- Which signals this device can read, and why not when it cannot. An
-- unreported verdict reads as "unknown", never as "available": an app
-- build older than a signal reports nothing for it, and reading silence
-- as health is how a 21-hour blackout stayed invisible.
alter table public.mileage_device_status
  add column if not exists signal_availability jsonb,
  add column if not exists signal_rejections integer,
  add column if not exists motion_activity_authorization text;

alter table public.mileage_device_heartbeats
  add column if not exists signal_availability jsonb,
  add column if not exists signal_rejections integer,
  add column if not exists motion_activity_authorization text;

comment on column public.mileage_device_status.signal_availability is
  'Per-signal verdict: available | unsupported | permission_denied | permission_not_requested | hardware_off | policy_blocked | unknown. Drives the degraded-mode ladder.';
comment on column public.mileage_device_status.signal_rejections is
  'Count of malformed or refused signal observations in the last report. Non-zero means a producer is emitting something we will not accept, which must be visible rather than absorbed.';
