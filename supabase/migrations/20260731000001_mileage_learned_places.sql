-- Learned significant places, computed server-side by clustering each
-- driver's existing mileage_points_raw history (lib/mileage/places.ts).
--
-- These feed the on-device geofence mesh that resurrects tracking after
-- the OS kills the app overnight. A geofence around home is delivered
-- by the platform even when our process is dead, so driving off the
-- driveway restarts capture before the drive has meaningfully begun.
--
-- DELIBERATELY A NEW TABLE, NOT A ROW KIND IN mileage_places.
-- mileage_places holds places the USER created, and finalize.ts feeds
-- it straight into suggestClassification(): both ends at a "home" place
-- means the trip is auto-classified personal. Writing machine-guessed
-- places into that table would silently reclassify real trips off the
-- back of a clustering heuristic. Learned places are advisory input to
-- the device only, and stay in their own table until someone decides
-- otherwise on purpose.
--
-- Purely additive: creates one table, changes nothing that exists.

create table if not exists public.mileage_learned_places (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  -- Deterministic key derived from the cluster centroid rounded to
  -- three decimals (about 110 m). Stable across recomputes so the
  -- device keeps the same geofence ids and does not churn its mesh.
  learned_key text not null,
  label text not null check (label in ('home', 'work', 'stop')),
  lat double precision not null,
  lng double precision not null,
  radius_m integer not null check (radius_m between 100 and 500),
  visits integer not null default 0,
  dwell_hours numeric(10, 2) not null default 0,
  -- 0 is the most important place. The device registers the lowest
  -- ranks first because platform region monitoring is a limited
  -- resource (iOS allows 20 regions per app).
  rank integer not null default 0,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (driver_user_id, company_id, learned_key)
);

create index if not exists mileage_learned_places_driver_idx
  on public.mileage_learned_places (driver_user_id, company_id, rank);

alter table public.mileage_learned_places enable row level security;

-- Drivers may read their own learned places (the device fetches them
-- to register geofences). Writes are service-role only: the clustering
-- runs on the server and a client must not be able to point its own
-- geofences somewhere it was never observed.
drop policy if exists "mileage_learned_places_select_own" on public.mileage_learned_places;
create policy "mileage_learned_places_select_own"
  on public.mileage_learned_places
  for select
  using (driver_user_id = auth.uid());

comment on table public.mileage_learned_places is
  'Server-clustered significant places per driver. Feeds the on-device geofence mesh that restarts tracking after an overnight process kill. Advisory only: not used for trip classification.';

-- Geofence-mesh health on the heartbeat.
--
-- Without these a device whose mesh silently failed to register looks
-- exactly like a device that simply had no drives that day, which is
-- the ambiguity that let a week of missing morning commutes pass
-- unnoticed.
--
-- geofence_capture is the load-bearing column. 'blind_no_fix' means a
-- geofence exit DID start the location foreground service and it then
-- received no location at all: the permission reported granted and was
-- not actually usable. A row in that state is a failure and must never
-- be read as a healthy tracking day.
--
-- Additive only: new nullable columns on both the latest-state table
-- and the append-only history, no existing column touched.
alter table public.mileage_device_status
  add column if not exists geofence_arm_state text,
  add column if not exists geofence_count integer,
  add column if not exists geofence_capture text,
  add column if not exists geofence_buffered_fixes integer;

alter table public.mileage_device_heartbeats
  add column if not exists geofence_arm_state text,
  add column if not exists geofence_count integer,
  add column if not exists geofence_capture text,
  add column if not exists geofence_buffered_fixes integer;
