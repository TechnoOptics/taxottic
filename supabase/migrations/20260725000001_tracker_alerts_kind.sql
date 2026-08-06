-- Let a "parked" alert episode coexist with a "silent" one per driver.
--
-- mileage_tracker_alerts was keyed (driver, company) with one implicit
-- meaning: the device went silent. The parked-device push (device
-- uploading fine but nothing moving for 48h+) is a distinct episode
-- with its own notify/renotify/clear lifecycle, so the episode key
-- gains a `kind`. Existing rows are silent episodes by definition,
-- which is exactly what the default backfills.
alter table public.mileage_tracker_alerts
  add column if not exists kind text not null default 'silent'
  check (kind in ('silent', 'parked'));

alter table public.mileage_tracker_alerts
  drop constraint if exists mileage_tracker_alerts_pkey;

alter table public.mileage_tracker_alerts
  add primary key (driver_user_id, company_id, kind);
