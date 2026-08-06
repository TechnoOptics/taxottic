-- Recovered 20260725164107 (tracker_alerts_kind) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Let a "parked" alert episode coexist with a "silent" one per driver.
alter table public.mileage_tracker_alerts
  add column if not exists kind text not null default 'silent'
  check (kind in ('silent', 'parked'));

alter table public.mileage_tracker_alerts
  drop constraint if exists mileage_tracker_alerts_pkey;

alter table public.mileage_tracker_alerts
  add primary key (driver_user_id, company_id, kind);
