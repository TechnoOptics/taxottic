-- One column that says whether what we shipped is actually alive.
--
-- Every other column here reports a MEASUREMENT. This one reports a
-- VERDICT, and that difference is the point.
--
-- On 2026-08-15 three separate features were found dead in production,
-- each for weeks, and each presented identically: a null column.
--
--   iOS plugins      compiled, @objc, CAPBridgedPlugin, in the pbxproj,
--                    never registered with the Capacitor bridge
--   Bluetooth wake   plugin, wrapper and receiver all correct, nothing
--                    ever called the permission request
--   Trip endpoints   columns read by the UI, never written
--
-- A null reads as "not measured yet" and gets skipped. That is why
-- location_authorization sitting NULL on an iPhone for weeks was read as
-- a driver who had not granted Always, when the truth was a dead plugin.
--
-- self_check stores a verdict instead: "ok", or "dead=geofence_plugin,
-- device_status_plugin". Named rather than counted, because a count says
-- something is wrong and a name says what to fix, and this string will
-- be read in a database row by someone who was not there.
--
-- Text, not an enum: the capability list will grow, and a migration to
-- add a value is friction that discourages adding checks.

alter table public.mileage_device_status
  add column if not exists self_check text;

comment on column public.mileage_device_status.self_check is
  'Capability verdict, not a measurement. "ok" | "dead=<ids>" | "denied=<ids>" | "unknown=<ids>". dead means WE shipped something that will not answer; denied is the driver''s choice. See lib/mileage/self-check.ts.';

-- Finding every device with a shipped-but-broken capability is the query
-- this column exists to make possible, and it should stay cheap.
create index if not exists mileage_device_status_self_check_dead_idx
  on public.mileage_device_status (reported_at desc)
  where self_check like 'dead=%';

-- The same verdict on the HISTORY table.
--
-- mileage_device_status holds only the latest beat, so it answers "is
-- this device broken now". The heartbeats table is what answers "when
-- did it break, and did our fix actually take", which is the question
-- that matters the morning after a release. A verdict that exists only
-- in the current-state row cannot be plotted against a version.
--
-- lib/db/schema-contract.test.ts enforces that the payload matches BOTH
-- tables, and it caught this omission before it shipped.

alter table public.mileage_device_heartbeats
  add column if not exists self_check text;

comment on column public.mileage_device_heartbeats.self_check is
  'Capability verdict at the time of this beat. Same vocabulary as mileage_device_status.self_check; kept here so a fix can be proven to have landed rather than assumed.';
