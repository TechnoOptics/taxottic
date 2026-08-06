-- Recovered 20260525050010 (mileage_points_raw_staging) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Staging table for raw GPS points pre-segmentation.
--
-- Why this exists: the segmenter in lib/mileage/segmentation.ts
-- requires a 5-minute stationary dwell (or an 8-minute capture gap)
-- to close a trip. The device's @capgo plugin flushes every 2 min
-- during a drive. So every batch the server received was
-- mid-drive — continuous movement, no closing pause — and
-- segmentTrips returned 0 trips. The /api/mileage/ingest route
-- returned ok, the device cleared its local buffer, and the points
-- were lost.
--
-- This staging table changes the contract: incoming points ALWAYS
-- land here, immediately. The ingest route then runs segmentation
-- across the union of (new batch + all this user's unconsumed
-- staging rows). When a trip closes (real pause detected),
-- materializes it into mileage_trips + mileage_points and marks
-- the contributing staging rows as consumed. Points that belong to
-- an "open" trip (still moving at end of batch) stay in staging
-- for the next batch.
--
-- Net effect: even a 6-hour continuous drive with no pause produces
-- a trip the moment a pause is finally detected at the end. Nothing
-- is dropped silently.

create table if not exists public.mileage_points_raw (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  captured_at timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  speed_mps double precision,
  accuracy_m double precision,
  -- Marked when a row's data is rolled into mileage_points as part
  -- of a closed trip. Kept around for forensic audit (you can see
  -- which raw fix became which trip row) — periodic cleanup can
  -- delete consumed rows older than N days.
  consumed_at timestamptz,
  consumed_trip_id uuid references public.mileage_trips(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Fast lookup of "all this user's UNCONSUMED points, ordered by
-- capture time" — the exact query the ingest route runs every batch.
create index if not exists mileage_points_raw_pending_idx
  on public.mileage_points_raw (driver_user_id, company_id, captured_at)
  where consumed_at is null;

alter table public.mileage_points_raw enable row level security;

-- Owner-only access via session client. Service-role (route handler)
-- bypasses RLS for the ingest path.
drop policy if exists "mileage_points_raw: own select" on public.mileage_points_raw;
create policy "mileage_points_raw: own select"
  on public.mileage_points_raw for select
  using (driver_user_id = auth.uid());

drop policy if exists "mileage_points_raw: own insert" on public.mileage_points_raw;
create policy "mileage_points_raw: own insert"
  on public.mileage_points_raw for insert
  with check (driver_user_id = auth.uid());

comment on table public.mileage_points_raw is
  'Staging area for raw GPS fixes that haven''t yet been segmented into a closed trip. The ingest route persists every incoming point here, then runs segmentation across all unconsumed rows for the user. Rows are marked consumed (with consumed_trip_id) when they roll into a finalised trip.';
