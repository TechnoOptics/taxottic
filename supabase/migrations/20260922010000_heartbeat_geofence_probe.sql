-- Why the geofence read returned what it did.
--
-- getGeofenceState collapsed three different worlds into one null: the
-- plugin is not registered, the plugin threw, and the call never came
-- back. Only the first is our bug, and the self-check was reporting all
-- three as death. One Android phone carried self_check =
-- "dead=geofence_plugin" in mileage_device_status while 163 of its own
-- heartbeats between 2026-08-24 and 2026-09-15 reported
-- geofence_arm_state = 'armed'. The plugin answered the whole time.
--
-- Read geofence_probe BEFORE geofence_arm_state. A null arm state next
-- to 'ok' is a plugin reporting nothing; next to 'timeout' it is a read
-- that never completed, which a backgrounded WebView produces routinely
-- on a healthy device. geofence_probe_ms says how long we actually
-- waited, as distinct from the nominal 2 second box.
--
-- Written by app/api/mileage/heartbeat/route.ts to BOTH tables from one
-- payload, exactly like car_probe / car_probe_ms.

alter table public.mileage_device_heartbeats
  add column if not exists geofence_probe text,
  add column if not exists geofence_probe_ms integer;
alter table public.mileage_device_status
  add column if not exists geofence_probe text,
  add column if not exists geofence_probe_ms integer;
comment on column public.mileage_device_status.geofence_probe is
  'Why the geofence read returned what it did: ok, absent, error, timeout. "absent" is the only value that means the plugin is not registered; a null arm state with any other value means we did not manage to look.';
