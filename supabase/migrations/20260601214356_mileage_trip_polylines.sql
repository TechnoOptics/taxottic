-- Recovered 20260601214356 (mileage_trip_polylines) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

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
  where n <= p_max
     or rn = 1
     or rn = n
     or (rn - 1) % greatest(1, (n / p_max)) = 0
  order by trip_id, captured_at;
$$;

grant execute on function public.mileage_trip_polylines(uuid[], integer)
  to authenticated, service_role;
