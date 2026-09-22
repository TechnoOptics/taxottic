-- geofence_probe joins the vocabulary its siblings already speak.
--
-- 20260922010000 shipped the column with 'absent' meaning "the plugin
-- is not registered". That word was already taken: device_probe uses
-- 'absent' for "the client sent nothing we recognise", and both columns
-- sit in the SAME heartbeat row. One word, two meanings, one row is a
-- trap for whoever groups on these a year from now.
--
-- The client union is now the same four words as DeviceProbeOutcome
-- (ok, null, unavailable, error) plus the timeout the caller adds.
--
-- Worth more than the rename: 'unavailable' is reachable only OFF
-- native. guard() in lib/mileage/geofence.ts returns a registerPlugin
-- proxy on every native platform, registered or not, so an unregistered
-- plugin does not report "no bridge". It reports 'error', in one or two
-- milliseconds, because the bridge looked for a plugin of that name and
-- found nothing to call. That fast rejection is the ONLY evidence that
-- convicts the plugin, and it is why geofence_probe must always be read
-- next to geofence_probe_ms: the same 'error' at 400ms is a live plugin
-- that threw, and calling that dead is a false alarm.
--
-- Comment only. No data is rewritten because there is none: the column
-- shipped today and no build carrying it has reached a device.

comment on column public.mileage_device_status.geofence_probe is
  'Why the geofence read returned what it did: ok, null, unavailable, error, timeout. Same vocabulary as device_probe. ALWAYS read with geofence_probe_ms: "error" within ~10ms is an unregistered plugin (the bridge found nothing to call), while the same "error" slower than that is a live plugin that threw. "unavailable" happens only off-native. A null geofence_arm_state with any value other than a fast "error" means we did not manage to look, not that the plugin is dead.';
comment on column public.mileage_device_status.geofence_probe_ms is
  'Wall-clock milliseconds the geofence read took. Load-bearing, not decoration: it is the only thing separating an unregistered plugin from a live one that threw. See geofence_probe.';
