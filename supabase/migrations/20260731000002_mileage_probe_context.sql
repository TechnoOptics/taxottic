-- Probe CONTEXT for the device-truth blackout, plus provenance for the
-- foreground-cached fallback.
--
-- Where this stands. Device-truth fields (location_authorization,
-- precise_location, battery_optimized, background_refresh,
-- last_exit_reason) have been NULL in production for weeks on both
-- platforms. The probe added in 20260731000000 made the failure name
-- itself, and the first probed heartbeat from a real device came back
-- device_probe = 'timeout' and exit_probe = 'timeout'.
--
-- PROVEN by that row: the Capacitor bridge exists, the plugin is
-- registered, and the OS is not returning an empty answer. The call is
-- issued and does not come back inside the time box (3000 ms for device
-- status, 2000 ms for exit info).
--
-- NOT PROVEN: why. The leading hypothesis is that heartbeats fire while
-- the app is backgrounded and the WebView JS thread is throttled hard
-- enough that the promise resolution is starved past the box. That is
-- plausible and unverified. These columns exist so the next production
-- sample decides it rather than another argument doing so.
--
-- Purely additive: new nullable columns only. No existing column is
-- altered or dropped and no row is rewritten, so every current reader
-- (app/api/cron/mileage-finalize, lib/mileage/team-health.ts, the
-- manager health overlay) is untouched.

-- device_probe_ms / exit_probe_ms
--   Measured wall-clock elapsed of each probe. The decisive one, and it
--   cuts in a direction that is easy to get backwards: the time box is
--   itself a setTimeout, so throttled timers make it fire LATE, giving
--   the bridge MORE wall time. A 'timeout' at ~3000 ms therefore proves
--   our timers ran on schedule, i.e. the JS thread was NOT starved and
--   the native call is what failed to answer. A 'timeout' at, say,
--   45000 ms proves the opposite.
--
-- device_probe_stage / exit_probe_stage
--   Which await the probe was sitting in: 'bridge' = still inside
--   await import("@capacitor/core"), so it never reached the native
--   call and this is a JS module-loading failure; 'call' = the native
--   method was invoked and never resolved. Values:
--   start | bridge | call | done.
--
-- probe_foreground
--   The OS's own statement about the app process, from @capacitor/app
--   appStateChange. NULL = the device has not told us yet; it is never
--   guessed. This is the column that tests the hypothesis directly: if
--   probes succeed with probe_foreground = true and time out with
--   false, foregrounding is the variable. If timeouts also appear with
--   probe_foreground = true, it is not.
--
-- probe_visibility
--   document.visibilityState, recorded as a weaker cross-check ONLY.
--   Using visibility as a proxy for foreground is a mistake already
--   made in this codebase (it made the tracker watchdog dead code), so
--   it is stored beside the real signal rather than instead of it.
--
-- timer_lag_ms
--   How late a plain 1 s timer ran while the probes were in flight.
--   Small lag + timeout = the JS thread was fine. Large lag = the JS
--   thread was starved, which is the throttling hypothesis showing up
--   as a number.
alter table public.mileage_device_status
  add column if not exists device_probe_ms int;
alter table public.mileage_device_status
  add column if not exists device_probe_stage text;
alter table public.mileage_device_status
  add column if not exists exit_probe_ms int;
alter table public.mileage_device_status
  add column if not exists exit_probe_stage text;
alter table public.mileage_device_status
  add column if not exists probe_foreground boolean;
alter table public.mileage_device_status
  add column if not exists probe_visibility text;
alter table public.mileage_device_status
  add column if not exists timer_lag_ms int;

alter table public.mileage_device_heartbeats
  add column if not exists device_probe_ms int;
alter table public.mileage_device_heartbeats
  add column if not exists device_probe_stage text;
alter table public.mileage_device_heartbeats
  add column if not exists exit_probe_ms int;
alter table public.mileage_device_heartbeats
  add column if not exists exit_probe_stage text;
alter table public.mileage_device_heartbeats
  add column if not exists probe_foreground boolean;
alter table public.mileage_device_heartbeats
  add column if not exists probe_visibility text;
alter table public.mileage_device_heartbeats
  add column if not exists timer_lag_ms int;

-- Provenance of the device-truth columns themselves.
--
-- The client now prefers a live probe and falls back to the last value
-- read while the app was genuinely foregrounded, because what is being
-- read (a permission level, a battery-optimization exemption,
-- Background App Refresh) changes when a human changes it, not minute
-- to minute. A value from the last foreground moment is nearly as good
-- as a live one and infinitely better than NULL.
--
-- device_status_source: 'live'  this heartbeat's probe answered
--                       'cache' last successful foreground read
--                       'none'  still nothing, the honest NULL
-- device_status_age_s:  0 for 'live', otherwise the age of the cached
--                       read in seconds.
--
-- These two must be read WITH location_authorization / precise_location
-- / battery_optimized / low_power_mode / background_refresh. Without
-- them a nine-hour-old value is indistinguishable from a current one,
-- which would trade a visible NULL for an invisible lie.
alter table public.mileage_device_status
  add column if not exists device_status_source text;
alter table public.mileage_device_status
  add column if not exists device_status_age_s int;

alter table public.mileage_device_heartbeats
  add column if not exists device_status_source text;
alter table public.mileage_device_heartbeats
  add column if not exists device_status_age_s int;

-- Reading the answer out of the data. Run this once app builds carrying
-- these fields are in drivers' hands and a few hours of heartbeats have
-- landed:
--
--   select device_probe,
--          probe_foreground,
--          count(*) as rows,
--          round(avg(device_probe_ms)) as avg_probe_ms,
--          max(device_probe_ms) as max_probe_ms,
--          round(avg(timer_lag_ms)) as avg_timer_lag_ms,
--          max(timer_lag_ms) as max_timer_lag_ms,
--          count(*) filter (where device_probe_stage = 'bridge') as stuck_importing,
--          count(*) filter (where device_probe_stage = 'call') as stuck_in_native
--   from public.mileage_device_heartbeats
--   where reported_at >= now() - interval '2 days'
--     and device_probe_ms is not null
--   group by 1, 2
--   order by 1, 2;
--
-- Verdicts:
--   ok rows concentrated at probe_foreground = true and timeout rows at
--   false, with avg_probe_ms on those timeouts around 3000 and small
--   timer lag -> the app being backgrounded is the trigger, but the JS
--   thread was running, so timer throttling is NOT the mechanism and
--   the native side is where to look next.
--
--   timeout rows with large timer_lag_ms and device_probe_ms well above
--   3000 -> the WebView really was starved. Background throttling
--   confirmed.
--
--   timeouts present at probe_foreground = true -> foregrounding is not
--   the variable at all, and the whole background story is dead.
--
--   stuck_importing > 0 -> the dynamic import of @capacitor/core is the
--   hang, and this was never a native problem.
--
-- And to confirm the fallback is actually doing its job, i.e. device
-- truth is no longer NULL even while the live probe keeps failing:
--
--   select device_status_source,
--          count(*) as rows,
--          count(location_authorization) as auth_present,
--          round(avg(device_status_age_s)) as avg_age_s,
--          max(device_status_age_s) as max_age_s
--   from public.mileage_device_heartbeats
--   where reported_at >= now() - interval '2 days'
--   group by 1;
