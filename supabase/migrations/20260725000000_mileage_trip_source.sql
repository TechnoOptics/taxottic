-- Trip provenance (audit findings 1 + 2, both critical).
--
-- The finalize/reconcile machinery assumed every mileage_trips row was
-- rebuildable from mileage_points_raw. That is only true of TRACKED
-- trips: manual entries carry a user-typed odometer distance with zero
-- rendered points, and route reconstructions carry a Google-Directions
-- road distance. Without provenance, renderTripFromRaw could overwrite a
-- user's 120-mile manual entry with an 8-mile partial GPS trace (the
-- broken-trips reconciler flags any trip with >=5 undrawn raw points in
-- its window, which is exactly what a died-mid-drive trace looks like),
-- and the overlap-dedupe 'replace' path could hard-delete a
-- user-authored trip in favour of an auto fragment.
--
-- source semantics:
--   tracked = materialized from device GPS; safe to re-render from raw.
--   manual  = user-typed distance/time; NEVER machine-rewritten.
--   route   = reconstructed from stops via road routing; NEVER
--             machine-rewritten (its polyline is synthetic, not raw).

alter table public.mileage_trips
  add column if not exists source text not null default 'tracked'
  check (source in ('tracked', 'manual', 'route'));

-- Backfill from the notes markers the server actions have always
-- written. Anything else predating this column is tracked.
update public.mileage_trips
  set source = 'manual'
  where source = 'tracked' and notes = 'manual entry';

update public.mileage_trips
  set source = 'route'
  where source = 'tracked' and notes like 'Reconstructed from entered stops%';

-- Reconciler only ever repairs tracked trips now. Same signature and
-- grants as 20260716000000; only the source filter is new.
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
    and t.source = 'tracked'
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
