-- Heartbeat HISTORY (append-only), so a tracking blackout stops erasing
-- its own evidence.
--
-- mileage_device_status keeps exactly one row per (driver, company) and
-- is overwritten by every heartbeat. That makes it useless for post-hoc
-- diagnosis: by the time anyone investigates a multi-hour blackout, the
-- row has already been replaced by a healthy heartbeat sent seconds
-- after the driver reopened the app. Two real blackouts (16.6 h and
-- 21.6 h on one driver, 19.6 h and 27 h on another) left no trace at
-- all, and last_exit_reason was NULL throughout.
--
-- Shape: a separate append-only table rather than versioning
-- mileage_device_status. mileage_device_status stays exactly as it is
-- (latest-state view) so its existing readers are untouched:
--   - app/api/cron/mileage-finalize/route.ts (fresh-heartbeat stall
--     escalation, selects tracking_enabled/last_cb_age_s/
--     location_authorization/reported_at)
--   - lib/mileage/team-health.ts (manager health overlay, selects
--     tracking_enabled/background_refresh)
-- Both keep reading one current row per driver with no change.
--
-- The heartbeat writer (app/api/mileage/heartbeat/route.ts) now writes
-- BOTH: upsert latest-state, then append history.
--
-- Service-role writes only, exactly like mileage_device_status: RLS on
-- with no policies, so nothing can be read or written with an anon or
-- authenticated key.
create table if not exists public.mileage_device_heartbeats (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  reported_at timestamptz not null default now(),
  platform text,
  app_version text,
  tracking_enabled boolean not null default false,
  buffer_size int not null default 0,
  last_cb_age_s int,
  fail_streak int not null default 0,
  location_authorization text,
  precise_location boolean,
  battery_optimized boolean,
  low_power_mode boolean,
  background_refresh boolean,
  last_exit_reason text,
  last_exit_at timestamptz,
  last_exit_detail jsonb,
  -- Outcome of the two native-bridge reads that feed the columns above.
  -- Without these, a NULL location_authorization is ambiguous: it could
  -- mean "the plugin answered and had nothing" or "the bridge is dead".
  -- Production currently shows every plugin-sourced field NULL on both
  -- platforms, so telling those two apart is the whole investigation.
  -- Values: ok | null | timeout | error | absent (absent = an older app
  -- build that predates this field).
  device_probe text,
  exit_probe text
);

-- The blackout query: for one driver, walk consecutive heartbeats in a
-- time range and measure the gap between them. This index makes that a
-- range scan.
create index if not exists mileage_device_heartbeats_driver_time_idx
  on public.mileage_device_heartbeats (driver_user_id, company_id, reported_at desc);

-- Company-wide sweeps ("did every driver go dark at once?") and the
-- retention purge, which deletes by reported_at.
create index if not exists mileage_device_heartbeats_company_time_idx
  on public.mileage_device_heartbeats (company_id, reported_at desc);
create index if not exists mileage_device_heartbeats_reported_at_idx
  on public.mileage_device_heartbeats (reported_at);

alter table public.mileage_device_heartbeats enable row level security;

-- Parity columns on the latest-state table so both writes carry the
-- same payload and the current row also says whether the bridge
-- answered. Purely additive; existing readers select named columns and
-- are unaffected.
alter table public.mileage_device_status
  add column if not exists device_probe text;
alter table public.mileage_device_status
  add column if not exists exit_probe text;

-- Diagnosing a blackout after the fact (fill in the driver and window):
--
--   with hb as (
--     select reported_at, tracking_enabled, last_cb_age_s, fail_streak,
--            buffer_size, platform, app_version, location_authorization,
--            background_refresh, battery_optimized, low_power_mode,
--            last_exit_reason, last_exit_at, device_probe, exit_probe,
--            lag(reported_at) over (order by reported_at) as prev_at
--     from public.mileage_device_heartbeats
--     where driver_user_id = '<driver uuid>'
--       and reported_at >= now() - interval '7 days'
--   )
--   select prev_at as gap_start, reported_at as gap_end,
--          round(extract(epoch from reported_at - prev_at) / 60) as gap_min,
--          tracking_enabled, last_cb_age_s, fail_streak, buffer_size,
--          location_authorization, background_refresh, battery_optimized,
--          last_exit_reason, last_exit_at, device_probe, exit_probe,
--          platform, app_version
--   from hb
--   where prev_at is not null
--     and reported_at - prev_at > interval '20 minutes'
--   order by gap_min desc;
