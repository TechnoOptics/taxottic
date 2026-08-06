-- Recovered 20260522234215 (profiles_mileage_schedule) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Per-user mileage tracking schedule. JSONB so we can grow the
-- shape (windows per day, multiple per day, exceptions, etc.)
-- without another migration each time the UX evolves.
--
-- Shape:
--   { "mode": "always" }
--   { "mode": "weekdays", "from": "08:00", "to": "18:00" }
--   { "mode": "custom",
--     "windows": {
--       "mon": [{ "from": "09:00", "to": "17:00" }],
--       "tue": [{ "from": "09:00", "to": "17:00" }],
--       ...
--     }
--   }
-- null  → no schedule constraint; auto-track runs whenever
--         the toggle is on (current behaviour).
alter table public.profiles
  add column if not exists mileage_schedule jsonb;
comment on column public.profiles.mileage_schedule is
  'Optional time-of-day schedule for the auto-mileage tracker. See app/mileage/schedule for the UI; null = no constraint.';
