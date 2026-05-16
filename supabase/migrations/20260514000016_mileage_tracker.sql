-- Mileage tracker — Phase 2 data model.
--
-- Three tables behind the GPS breadcrumb feature:
--   mileage_places  — home/office/client/other geofenced markers
--   mileage_trips   — one segmented drive (start/end, miles,
--                      business|personal classification, the IRS
--                      deduction already computed at ingestion)
--   mileage_points  — the breadcrumb trail for a trip
--
-- The ingestion API writes with the service-role client (it has a
-- validated user, scopes every row by driver_user_id = user.id —
-- the codebase's standard "trust the JWT, write with admin"
-- pattern). RLS below governs the DASHBOARD reads (user session
-- client): a driver sees their own; company managers + the
-- engaged firm see the team's; super-admin sees all.

-- ---------------------------------------------------------------
-- enums
-- ---------------------------------------------------------------
do $$ begin
  create type public.mileage_place_kind as enum
    ('home','office','client','other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.mileage_classification as enum
    ('business','personal','unclassified');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------
-- mileage_places
-- ---------------------------------------------------------------
create table if not exists public.mileage_places (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  kind public.mileage_place_kind not null default 'other',
  label text,
  lat double precision not null,
  lng double precision not null,
  -- Geofence radius (m). 120 m comfortably covers a building +
  -- parking without bleeding into the next address.
  radius_m integer not null default 120 check (radius_m between 20 and 5000),
  created_at timestamptz not null default now()
);
create index if not exists mileage_places_company_idx
  on public.mileage_places (company_id);

alter table public.mileage_places enable row level security;

drop policy if exists "mileage_places company members manage"
  on public.mileage_places;
create policy "mileage_places company members manage"
  on public.mileage_places for all
  using (
    public.is_company_member(company_id)
    or public.firm_has_active_engagement_with(company_id)
    or public.is_super_admin()
  )
  with check (
    public.is_company_member(company_id)
    or public.is_super_admin()
  );

-- ---------------------------------------------------------------
-- mileage_trips
-- ---------------------------------------------------------------
create table if not exists public.mileage_trips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  -- The person who drove (the team member). Distinct from the
  -- account manager who reviews on the firm map.
  driver_user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  distance_miles numeric(10,3) not null default 0,
  classification public.mileage_classification not null default 'unclassified',
  classified_by uuid references public.profiles(id) on delete set null,
  classified_at timestamptz,
  start_place_id uuid references public.mileage_places(id) on delete set null,
  end_place_id uuid references public.mileage_places(id) on delete set null,
  -- Tax year the drive falls in + the IRS standard-mileage
  -- deduction in cents, computed at ingestion (0 unless business).
  tax_year integer not null,
  deduction_cents bigint not null default 0,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists mileage_trips_company_idx
  on public.mileage_trips (company_id, started_at desc);
create index if not exists mileage_trips_driver_idx
  on public.mileage_trips (driver_user_id, started_at desc);
create index if not exists mileage_trips_year_idx
  on public.mileage_trips (company_id, tax_year, classification);

alter table public.mileage_trips enable row level security;

drop policy if exists "mileage_trips driver full access"
  on public.mileage_trips;
create policy "mileage_trips driver full access"
  on public.mileage_trips for all
  using (driver_user_id = auth.uid())
  with check (driver_user_id = auth.uid());

drop policy if exists "mileage_trips manager + firm read"
  on public.mileage_trips;
create policy "mileage_trips manager + firm read"
  on public.mileage_trips for select
  using (
    public.is_company_manager(company_id)
    or public.firm_has_active_engagement_with(company_id)
    or public.is_super_admin()
  );

-- A company manager (or engaged firm) can re-classify a team
-- member's trip (business/personal) without owning the drive.
drop policy if exists "mileage_trips manager reclassify"
  on public.mileage_trips;
create policy "mileage_trips manager reclassify"
  on public.mileage_trips for update
  using (
    public.is_company_manager(company_id)
    or public.firm_has_active_engagement_with(company_id)
    or public.is_super_admin()
  )
  with check (
    public.is_company_manager(company_id)
    or public.firm_has_active_engagement_with(company_id)
    or public.is_super_admin()
  );

-- ---------------------------------------------------------------
-- mileage_points (the breadcrumb trail)
-- ---------------------------------------------------------------
create table if not exists public.mileage_points (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.mileage_trips(id) on delete cascade,
  captured_at timestamptz not null,
  lat double precision not null,
  lng double precision not null,
  speed_mps double precision,
  accuracy_m double precision
);
create index if not exists mileage_points_trip_idx
  on public.mileage_points (trip_id, captured_at);

alter table public.mileage_points enable row level security;

-- A point is visible to whoever can see its parent trip.
drop policy if exists "mileage_points follow trip visibility"
  on public.mileage_points;
create policy "mileage_points follow trip visibility"
  on public.mileage_points for select
  using (
    exists (
      select 1 from public.mileage_trips t
      where t.id = mileage_points.trip_id
        and (
          t.driver_user_id = auth.uid()
          or public.is_company_manager(t.company_id)
          or public.firm_has_active_engagement_with(t.company_id)
          or public.is_super_admin()
        )
    )
  );

drop policy if exists "mileage_points driver insert"
  on public.mileage_points;
create policy "mileage_points driver insert"
  on public.mileage_points for insert
  with check (
    exists (
      select 1 from public.mileage_trips t
      where t.id = mileage_points.trip_id
        and t.driver_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------
-- realtime: the account-manager map live-updates as drives land
-- ---------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.mileage_trips;
exception when others then null; end $$;
