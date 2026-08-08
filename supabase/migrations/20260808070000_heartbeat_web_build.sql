-- Record WHICH JS BUNDLE produced each heartbeat.
--
-- `app_version` is the native binary, read from @capacitor/app. This app is
-- a WebView on a REMOTE url, so the binary version says nothing about the
-- web code actually executing: a phone can run native 1.3.7 while its
-- service worker serves a bundle from a week earlier. That is not
-- hypothetical here. public/sw.js records both drivers sitting on a bundle
-- in the v135 to v141 range for four days while production served v148.
--
-- Why this column matters more than it looks:
--
-- Device-truth fields (location_authorization, precise_location,
-- battery_optimized, background_refresh, last_exit_reason) have been NULL on
-- 100% of heartbeats since this table was created. On 2026-08-01, #475
-- replaced a hanging `await import("@capacitor/core")` with a static import
-- to fix exactly that. Since then, 343 heartbeats report the IDENTICAL
-- failure: device_probe='timeout', device_probe_stage='bridge'. And
-- 'bridge' is the stage the OLD dynamic-import code reported.
--
-- So either that fix does not work, or those devices never received it.
-- Those demand opposite responses, and the data cannot currently tell them
-- apart, because nothing in a heartbeat identifies the bundle that produced
-- it. The ambiguity is the blocker, not the bug.
--
-- The same trap already cost this project weeks once: a bare NULL could not
-- distinguish "no bridge" from "plugin missing" from "call hung", and making
-- the emptiness self-describing settled it in a single heartbeat. This does
-- the same thing one level up.
--
-- After this ships, the question becomes one query:
--
--   select web_build, device_probe, device_probe_stage, count(*)
--   from mileage_device_heartbeats
--   where reported_at > now() - interval '24 hours'
--   group by 1,2,3;
--
-- A device reporting a CURRENT web_build and still timing out means the fix
-- is wrong. A device reporting a stale web_build means it never got the fix.
--
-- Nullable with no default: NULL means a client too old to send it, which is
-- itself the answer to "is this device on current code".

alter table public.mileage_device_heartbeats
  add column if not exists web_build text;

comment on column public.mileage_device_heartbeats.web_build is
  'Short build id of the JS bundle that produced this heartbeat, distinct from app_version (the native binary). NULL means a client predating this column. See lib/build-id.ts.';
