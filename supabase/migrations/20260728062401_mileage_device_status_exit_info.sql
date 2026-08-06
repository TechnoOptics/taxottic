-- Recovered 20260728062401 (mileage_device_status_exit_info) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- OS-reported process death.
--
-- Until now "tracking stopped and nothing crashed" was diagnosed by
-- inference from GPS silence, which cannot tell a Samsung battery kill
-- from a user force-stop from an out-of-memory kill from a revoked
-- permission. Both platforms expose the real answer:
--   Android: ApplicationExitInfo.getReason() (API 30+)
--   iOS:     MetricKit MXBackgroundExitData counters (iOS 14+)
--
-- last_exit_reason is a normalized, human-readable slug so the manager
-- health view and triage can branch on it without parsing.
-- last_exit_detail keeps the full platform payload for forensics.
alter table public.mileage_device_status
  add column if not exists last_exit_reason text,
  add column if not exists last_exit_at timestamptz,
  add column if not exists last_exit_detail jsonb;
