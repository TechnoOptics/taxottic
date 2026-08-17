-- Somewhere to put the vehicle signals the iOS native layer records.
--
-- WHY THIS EXISTS.
--
-- lib/mileage/device-status.ts exports drainVehicleSignals,
-- clearVehicleSignals, queryMotionHistory and auditCaptureGap. All four
-- are implemented, all four are bridged in
-- ios/App/App/TaxotticDeviceStatusPlugin.swift, the plugin is registered
-- on a bridge that demonstrably works (device_probe='ok', stage='done',
-- 243 iOS beats on app 1.3.11), and NOTHING IN THE APP EVER CALLED ONE
-- OF THEM. Three layers of correct-looking implementation delivering
-- zero rows, for the sixth time in two days.
--
-- The consumer that closes the chain is lib/mileage/signal-adapter.ts,
-- salvaged from the closed PR #496. The scoring engine it fed is NOT
-- salvaged, deliberately: see below.
--
-- WHAT WE EXPECT TO SEE, AND WHY THAT IS STILL WORTH SHIPPING.
--
-- Measured over the 7 days to 2026-08-17:
--
--   android  car_probe=ok     31 beats   car_connects: 0
--   ios      car_probe=error 497 beats   car_connects: 0
--
-- ZERO car connections have ever been recorded, on any platform. So
-- these columns may well fill with nulls and zeroes. That is a FINDING,
-- not an empty column: it would establish that the signals do not fire,
-- which is currently unknown and is blocking any decision about whether
-- to fuse them at all. Nothing here asserts that a car signal means
-- anything yet, and no weight, half-life or score is stored, because
-- tuning a fusion model against inputs that have never fired would be
-- fitting noise.
--
-- vehicle_probe is FIRST-CLASS for the same reason car_probe is. It
-- separates "the bridge did not answer" from "the bridge answered and
-- the buffer was empty", and those two have completely different fixes.
--
-- motion_gap_automotive_ms is DURATION ONLY. It comes from
-- CMMotionActivityManager's history, which contains no location
-- whatsoever, so it can establish that a drive happened and never where
-- it went or how far. There is deliberately no distance column here and
-- there must never be one: a fabricated mile is worse than a missed one.
--
-- BOTH TABLES, NOT ONE.
--
-- app/api/mileage/heartbeat/route.ts builds ONE payload and upserts it
-- into mileage_device_status first, returning 500 on error before the
-- history append ever runs. Adding a column to only one of these tables
-- does not degrade the heartbeat, it DELETES it: every device, both
-- platforms, silently, for as long as it takes someone to notice. That
-- has happened here before, which is why
-- lib/db/schema-contract.test.ts asserts the payload against both.
--
-- Purely additive: new nullable columns only, no UPDATE, no DELETE, no
-- altered or dropped column.

alter table public.mileage_device_status
  add column if not exists vehicle_probe            text,
  add column if not exists vehicle_probe_ms         integer,
  add column if not exists vehicle_signals          jsonb,
  add column if not exists motion_available         boolean,
  add column if not exists motion_authorization     text,
  add column if not exists motion_audit_status      text,
  add column if not exists motion_audit_window_s    integer,
  add column if not exists motion_gap_automotive_ms integer;

alter table public.mileage_device_heartbeats
  add column if not exists vehicle_probe            text,
  add column if not exists vehicle_probe_ms         integer,
  add column if not exists vehicle_signals          jsonb,
  add column if not exists motion_available         boolean,
  add column if not exists motion_authorization     text,
  add column if not exists motion_audit_status      text,
  add column if not exists motion_audit_window_s    integer,
  add column if not exists motion_gap_automotive_ms integer;

comment on column public.mileage_device_heartbeats.vehicle_probe is
  'Outcome of the vehicle-signal drain: ok | null | unavailable | error | timeout. Read this BEFORE the other vehicle_/motion_ columns. "null" means the bridge answered and the native buffer was empty; "error"/"timeout" is a finding about the bridge, not an absence of cars.';

comment on column public.mileage_device_heartbeats.vehicle_signals is
  'Folded signal observations as accepted by parseSignalReport (lib/mileage/signals.ts): { observations, rejected }. Client-supplied and server-validated; anything refused is listed in rejected with a reason rather than dropped.';

comment on column public.mileage_device_heartbeats.motion_authorization is
  'CoreMotion authorization as the device reports it: authorized | denied | restricted | notDetermined. The most likely explanation for an empty vehicle_signals on iOS.';

comment on column public.mileage_device_heartbeats.motion_gap_automotive_ms is
  'Automotive time the OS recorded inside a capture gap we have not yet acknowledged. DURATION ONLY - motion history carries no location, so this must never be converted into a distance.';
