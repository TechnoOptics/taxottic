-- Self-healing detector for the "straight line across no road" bug.
--
-- A trip is "broken" when its own time window contains materially more
-- usable (accuracy <= 100 m) raw staging points than were actually drawn
-- into mileage_points. That is the exact signature of a drive whose
-- points arrived across multiple flush batches and had a stretch consumed
-- but never rendered (see lib/mileage/finalize.ts renderTripFromRaw). The
-- mileage-finalize cron calls this every tick and rebuilds each hit, so a
-- future regression self-heals within one interval instead of silently
-- corrupting a driver's mileage.
--
-- STABLE + SECURITY DEFINER: the cron runs as the service role (which
-- already bypasses RLS), but definer + a pinned search_path keeps this
-- safe if it is ever granted more broadly.

create or replace function public.mileage_broken_trips(
  p_since timestamptz,
  p_lim int default 200
)
returns table (
  trip_id uuid,
  driver_user_id uuid,
  company_id uuid,
  started_at timestamptz,
  ended_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id,
    t.driver_user_id,
    t.company_id,
    t.started_at,
    t.ended_at
  from public.mileage_trips t
  where t.started_at >= p_since
    and (
      select count(distinct r.captured_at)
      from public.mileage_points_raw r
      where r.driver_user_id = t.driver_user_id
        and r.company_id = t.company_id
        and r.captured_at between t.started_at and t.ended_at
        and r.accuracy_m <= 100
    ) - (
      select count(*)
      from public.mileage_points mp
      where mp.trip_id = t.id
    ) >= 5
  order by t.started_at desc
  limit greatest(1, least(p_lim, 1000));
$$;

revoke all on function public.mileage_broken_trips(timestamptz, int) from public;
grant execute on function public.mileage_broken_trips(timestamptz, int) to service_role;
