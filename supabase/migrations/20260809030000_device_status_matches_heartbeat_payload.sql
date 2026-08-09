-- Give mileage_device_status the ten columns the heartbeat route has been
-- writing to it, and which only ever existed on mileage_device_heartbeats.
--
-- THIS IS WHY EVERY HEARTBEAT HAS BEEN FAILING.
--
-- app/api/mileage/heartbeat/route.ts builds ONE `payload` object and uses it
-- for both tables. It upserts that payload into mileage_device_status FIRST,
-- and only then appends the history row:
--
--     const { error } = await admin
--       .from("mileage_device_status")
--       .upsert(payload, { onConflict: "driver_user_id,company_id" });
--     if (error) return NextResponse.json({ error: "store_failed" }, 500);
--
-- Three migrations added fields to the payload and to the HISTORY table
-- only:
--
--     20260808040000_heartbeat_arm_interrupted   arm_interrupted_at
--     20260808070000_heartbeat_web_build         web_build
--     20260808080000_heartbeat_car_signals       car_* (eight columns)
--
-- So from the moment those deployed, the status upsert named ten columns
-- that do not exist, Postgres answered 42703, and the route returned 500
-- BEFORE reaching the history append. Not a throttle, not a lost row: every
-- heartbeat from every device on both platforms, rejected at the first
-- write.
--
-- The evidence fits exactly. Both drivers' last heartbeats are 2026-08-07
-- (17:51 and 21:51 UTC), then nothing. Both phones were simply idle
-- overnight; the three migrations above landed on 2026-08-08; and when the
-- phones resumed on the evening of the 8th they uploaded GPS continuously
-- while not one heartbeat was ever stored. There was no separate 2026-08-07
-- cause to find, which is where a whole evening went.
--
-- The cost of the silence was not the missing rows. It was that
-- geofence_arm_state, arm_interrupted_at, device_probe and web_build all
-- went dark together, so the stall sweep, the foreground-only detector and
-- every "is this device healthy" question lost their input at once, and a
-- 17.5 hour capture blackout on 2026-08-08 raised nothing.
--
-- Additive and idempotent: `add column if not exists`, all nullable, no
-- backfill, no rewrite. Existing rows keep NULL, which is the honest record
-- of a heartbeat that predates the field.
--
-- Types are copied from the heartbeat table deliberately, so the two stay
-- one shape. lib/db/schema-contract.test.ts is extended in the same change
-- to assert exactly that, statically, for the write payload — the existing
-- guard only covered SELECTs on the money tables, which is why a 42703 on a
-- WRITE to a mileage table walked straight past it.

alter table public.mileage_device_status
  add column if not exists arm_interrupted_at      timestamptz,
  add column if not exists web_build               text,
  add column if not exists car_probe               text,
  add column if not exists car_probe_ms            integer,
  add column if not exists car_projection_type     text,
  add column if not exists car_projection_observed boolean,
  add column if not exists car_connects            integer,
  add column if not exists car_disconnects         integer,
  add column if not exists car_bluetooth_adapter   text,
  add column if not exists car_pending_signals     integer;

comment on column public.mileage_device_status.web_build is
  'JS bundle that produced the latest heartbeat. Distinct from app_version: a WebView on a remote url can run a bundle days older than its native binary.';

comment on column public.mileage_device_status.arm_interrupted_at is
  'When the tracker arm was last torn down mid-flight. Mirrors mileage_device_heartbeats; both tables are written from the same payload and must stay the same shape.';
