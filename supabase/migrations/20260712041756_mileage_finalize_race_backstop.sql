-- Recovered 20260712041756 (mileage_finalize_race_backstop) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Race backstop for concurrent finalizeUserTrips runs (on-open, cron,
-- ingest can all segment the same pool simultaneously; the overlap check
-- is read-then-insert without isolation). Two runs segmenting the same
-- pool produce byte-identical started_at, so a unique index turns the
-- race's loser into a caught 23505 that finalize handles by consuming to
-- the winner's trip instead of double-inserting.
create unique index if not exists mileage_trips_driver_started_uniq
  on public.mileage_trips (driver_user_id, started_at);

-- Retention support: consumed raw points are queried by consumed_at age.
create index if not exists mileage_points_raw_consumed_at_idx
  on public.mileage_points_raw (consumed_at)
  where consumed_at is not null;
