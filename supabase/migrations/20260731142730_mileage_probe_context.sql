-- Recovered 20260731142730 (mileage_probe_context) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Probe context for the device-truth blackout, plus provenance for the
-- foreground-cached fallback. Purely additive: new nullable columns
-- only. No existing column is altered or dropped, no row is rewritten.
-- Full rationale in
-- supabase/migrations/20260731000002_mileage_probe_context.sql.
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
alter table public.mileage_device_status
  add column if not exists device_status_source text;
alter table public.mileage_device_status
  add column if not exists device_status_age_s int;

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
alter table public.mileage_device_heartbeats
  add column if not exists device_status_source text;
alter table public.mileage_device_heartbeats
  add column if not exists device_status_age_s int;
