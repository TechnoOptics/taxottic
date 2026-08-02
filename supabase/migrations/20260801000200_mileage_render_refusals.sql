-- A ledger of rebuilds the re-render path REFUSED to write (FMEA C6).
--
-- renderTripFromRaw recomputes distance_miles and deduction_cents from
-- whatever raw falls inside a window and writes them. isPlausibleTrip
-- guarded only the INSERT, so the re-render path had no plausibility
-- check at all: a rebuild could fabricate distance on a drive a human
-- had already confirmed, at the full IRS rate. The mode is not
-- theoretical, 808, 314 and 1,343 "mile" trips were fabricated from a
-- time-shifted backlog in one evening, worth $1,875 of false deduction.
--
-- assessRenderedTrack now refuses such a rebuild and keeps the trip's
-- existing distance. A refusal nobody can see is how this class of bug
-- survives, so every refusal lands here.
--
-- Shape notes:
--   trip_id is the PRIMARY KEY, not a serial. The reconcile cron rescans
--   the same broken trips every 10 minutes and would otherwise write
--   ~144 rows per trip per day. One row per trip, with first_seen_at /
--   last_seen_at / occurrences, keeps the ledger bounded while still
--   showing how long a refusal has been recurring.
--
--   kept_miles is the distance the trip RETAINS (the refused value is in
--   refused_miles). A refusal that keeps a materially smaller number than
--   it refused is the signature worth investigating first.
--
--   Service-role writes only: RLS on with no policies, exactly like
--   mileage_device_heartbeats. This is operator forensics, not user data.
--
-- Purely additive: one new table and one new function. No column is
-- altered or dropped, and no existing row is read or written.
create table if not exists public.mileage_render_refusals (
  trip_id uuid primary key
    references public.mileage_trips(id) on delete cascade,
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- implausible_average_speed | unsupported_gap
  reason text not null,
  -- Distance the rebuild wanted to write.
  refused_miles numeric(10, 3) not null,
  -- Distance the trip keeps instead. NULL when it could not be read.
  kept_miles numeric(10, 3),
  -- One human-readable line (describeRenderRefusal).
  detail text,
  -- The window the rebuild was rendered over, so the union that reached
  -- across a gap can be reconstructed later.
  window_start timestamptz,
  window_end timestamptz,
  occurrences int not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.mileage_render_refusals enable row level security;

-- "What is the pipeline refusing right now, worst first."
create index if not exists mileage_render_refusals_last_seen_idx
  on public.mileage_render_refusals (last_seen_at desc);

comment on table public.mileage_render_refusals is
  'One row per trip whose raw re-render was refused by assessRenderedTrack as implausible. The trip keeps its previous distance; this is the record that it happened.';

-- Upsert-with-counter. Done as a function so the app makes one round
-- trip and first_seen_at survives a repeat: a plain PostgREST upsert
-- would reset it and pin occurrences at 1.
create or replace function public.mileage_record_render_refusal(
  p_trip_id uuid,
  p_driver_user_id uuid,
  p_company_id uuid,
  p_reason text,
  p_refused_miles numeric,
  p_kept_miles numeric,
  p_detail text,
  p_window_start timestamptz,
  p_window_end timestamptz
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.mileage_render_refusals as r (
    trip_id, driver_user_id, company_id, reason, refused_miles,
    kept_miles, detail, window_start, window_end
  )
  values (
    p_trip_id, p_driver_user_id, p_company_id, p_reason, p_refused_miles,
    p_kept_miles, p_detail, p_window_start, p_window_end
  )
  on conflict (trip_id) do update set
    reason        = excluded.reason,
    refused_miles = excluded.refused_miles,
    kept_miles    = excluded.kept_miles,
    detail        = excluded.detail,
    window_start  = excluded.window_start,
    window_end    = excluded.window_end,
    occurrences   = r.occurrences + 1,
    last_seen_at  = now();
$$;

revoke all on function public.mileage_record_render_refusal(
  uuid, uuid, uuid, text, numeric, numeric, text, timestamptz, timestamptz
) from public, anon, authenticated;

grant execute on function public.mileage_record_render_refusal(
  uuid, uuid, uuid, text, numeric, numeric, text, timestamptz, timestamptz
) to service_role;
