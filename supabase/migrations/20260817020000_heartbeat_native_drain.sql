-- Somewhere to record that the native on-disk buffer was drained by
-- something other than a cold start.
--
-- Until now it was drained by nothing else. drainGeofenceBuffer() and
-- drainNativeLocationBuffer() had exactly one caller each, both inside
-- the tracker start path, so time-to-server for anything the native
-- resurrection path captured was bounded by when the driver next opened
-- the app. Measured over the ten days ending 2026-08-17: 48.8 % of
-- points arrived more than 30 minutes after capture, median 160 minutes
-- and p90 24 hours, while 1571 of 1593 batches carried a point captured
-- less than two minutes before receipt. Both facts at once, because the
-- lag is bimodal and this buffer is the slow mode. See
-- docs/design/upload-latency.md.
--
-- WHY A TRIGGER COLUMN AND NOT JUST A COUNTER.
--
-- geofence_buffered_fixes already exists and is the number that has to
-- fall. It cannot, on its own, tell "the drain now runs every couple of
-- minutes and finds nothing" from "the drain still never runs". Those
-- look identical from a counter sitting at zero and they are opposite
-- outcomes for this change. native_drain_trigger answers it directly:
-- any value other than 'start' is a drain that happened while the app
-- was already running.
--
-- native_drain_points then separates a live drain finding an empty
-- buffer from a live drain moving real backlog.
--
-- The question a reviewer runs after this ships:
--
--   select native_drain_trigger, count(*),
--          max(native_drain_points), max(geofence_buffered_fixes)
--   from public.mileage_device_heartbeats
--   where reported_at > now() - interval '2 days'
--   group by 1 order by 2 desc;
--
-- Rows with trigger in ('callback','flush','resume') mean the new call
-- sites are live. Only 'start' means the change did not take.
--
-- Both nullable: NULL means a client predating these columns, which is
-- every phone until the WebView picks up the new bundle.

alter table public.mileage_device_status
  add column if not exists native_drain_trigger text,
  add column if not exists native_drain_points  integer;

alter table public.mileage_device_heartbeats
  add column if not exists native_drain_trigger text,
  add column if not exists native_drain_points  integer;

comment on column public.mileage_device_heartbeats.native_drain_trigger is
  'Which event caused the last native-buffer drain attempt in this page life: start | resume | flush | callback. Anything other than "start" proves the buffer is being drained without a cold start, which is the property the drain fix was shipped for.';

comment on column public.mileage_device_heartbeats.native_drain_points is
  'Points moved by that drain attempt. 0 with a non-null trigger means the drain ran and the native buffer was empty, which is a healthy steady state and NOT the same as the drain never running.';
