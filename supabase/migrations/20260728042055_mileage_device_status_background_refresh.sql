-- Recovered 20260728042055 (mileage_device_status_background_refresh) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Background App Refresh state (iOS).
--
-- Verified against Apple's docs: with Background App Refresh OFF, the
-- system relaunches the app for NO location events at all — not
-- significant-location-change, not region monitoring. Low Power Mode
-- disables it automatically. Either one produces total, silent capture
-- failure with zero client-side error to log, which is exactly the
-- "drives just stopped" pattern we kept re-diagnosing from scratch.
--
-- The device has always been able to read this; it was simply never
-- transmitted. Storing it makes the blocker visible to the manager
-- health view and the stall triage instead of invisible.
alter table public.mileage_device_status
  add column if not exists background_refresh boolean;
