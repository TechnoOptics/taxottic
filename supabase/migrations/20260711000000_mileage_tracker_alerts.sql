-- Per-driver tracker-stall episode state, written only by the finalize
-- cron (service role). One row per (driver, company): stalled_since is
-- the last upload that preceded the silence, notified_at rate-limits
-- re-notification; the row is deleted when points flow again so the
-- next stall notifies fresh. No RLS policies on purpose: service-role
-- only, never read by clients.
create table if not exists public.mileage_tracker_alerts (
  driver_user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  stalled_since timestamptz not null,
  notified_at timestamptz not null,
  primary key (driver_user_id, company_id)
);
alter table public.mileage_tracker_alerts enable row level security;
