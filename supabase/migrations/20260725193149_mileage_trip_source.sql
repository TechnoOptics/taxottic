-- Recovered 20260725193149 (mileage_trip_source) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.mileage_trips
  add column if not exists source text not null default 'tracked'
  check (source in ('tracked', 'manual', 'route'));

update public.mileage_trips
  set source = 'manual'
  where source = 'tracked' and notes = 'manual entry';

update public.mileage_trips
  set source = 'route'
  where source = 'tracked' and notes like 'Reconstructed from entered stops%';

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
