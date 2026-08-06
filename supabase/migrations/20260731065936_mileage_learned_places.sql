-- Recovered 20260731065936 (mileage_learned_places) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.mileage_learned_places (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  learned_key text not null,
  label text not null check (label in ('home', 'work', 'stop')),
  lat double precision not null,
  lng double precision not null,
  radius_m integer not null check (radius_m between 100 and 500),
  visits integer not null default 0,
  dwell_hours numeric(10, 2) not null default 0,
  rank integer not null default 0,
  computed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (driver_user_id, company_id, learned_key)
);

create index if not exists mileage_learned_places_driver_idx
  on public.mileage_learned_places (driver_user_id, company_id, rank);

alter table public.mileage_learned_places enable row level security;

drop policy if exists "mileage_learned_places_select_own" on public.mileage_learned_places;
create policy "mileage_learned_places_select_own"
  on public.mileage_learned_places
  for select
  using (driver_user_id = auth.uid());

comment on table public.mileage_learned_places is
  'Server-clustered significant places per driver. Feeds the on-device geofence mesh that restarts tracking after an overnight process kill. Advisory only: not used for trip classification.';

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
