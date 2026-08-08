-- Allow a third tracker-alert episode kind: 'foreground_only'.
--
-- mileage_tracker_alerts already carries 'silent' (no uploads at all) and
-- 'parked' (uploads that never move). Neither can see the failure that cost
-- a real device four days of drives in August 2026: a tracker that only ever
-- arms while the user is looking at the screen.
--
-- That device is not silent, because each time the app is opened it uploads
-- a handful of points, and that upload CLEARS the silent episode. It is not
-- parked either, because those points do move. It just loses every drive
-- taken with the app closed, which is every real drive.
--
-- Detection lives in lib/mileage/foreground-only.ts and keys off the ratio
-- of background to foreground heartbeats, compared against the same device's
-- own history rather than against other devices, so Android (legitimately
-- foreground-heavy) is excluded without naming a platform.
--
-- The primary key is (driver_user_id, company_id, kind), so a new kind gets
-- its own episode row per driver and cannot collide with an open 'silent' or
-- 'parked' episode.

alter table public.mileage_tracker_alerts
  drop constraint if exists mileage_tracker_alerts_kind_check;

alter table public.mileage_tracker_alerts
  add constraint mileage_tracker_alerts_kind_check
  check (kind = any (array['silent'::text, 'parked'::text, 'foreground_only'::text]));
