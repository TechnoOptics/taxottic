-- Downsampled trip polylines for the breadcrumb maps.
--
-- The /mileage and /mileage/business pages used to embed
-- `mileage_points(...)` directly in the trips query. PostgREST caps any
-- embedded array at its max-rows (1000), so a long drive was truncated
-- mid-route: a real 35.8-mile home→destination drive (1,867 fixes)
-- rendered only its first ~1,000 fixes ≈ 19.4 miles, so the map line
-- stopped on a random street and the true destination was "missing".
--
-- This function returns up to p_max evenly-strided points per trip,
-- ALWAYS including the first and last fix so every route reaches its
-- real endpoints, ordered chronologically. Work is bounded regardless
-- of how long the drive is or how many trips are requested — a smooth
-- map line needs ~250 vertices, not thousands.
create or replace function public.mileage_trip_polylines(
  p_trip_ids uuid[],
  p_max integer default 250
)
returns table (
  trip_id uuid,
  lat double precision,
  lng double precision,
  captured_at timestamptz
)
language sql
stable
as $$
  with ranked as (
    select
      mp.trip_id,
      mp.lat,
      mp.lng,
      mp.captured_at,
      row_number() over (
        partition by mp.trip_id order by mp.captured_at
      ) as rn,
      count(*) over (partition by mp.trip_id) as n
    from public.mileage_points mp
    where mp.trip_id = any (p_trip_ids)
  )
  select trip_id, lat, lng, captured_at
  from ranked
  where n <= p_max               -- short trip: keep every fix
     or rn = 1                    -- always the start
     or rn = n                    -- always the true destination
     or (rn - 1) % greatest(1, (n / p_max)) = 0  -- even stride elsewhere
  order by trip_id, captured_at;
$$;

-- Service role (the pages' admin client) bypasses RLS; authenticated
-- callers run with RLS on mileage_points (security invoker default).
grant execute on function public.mileage_trip_polylines(uuid[], integer)
  to authenticated, service_role;
