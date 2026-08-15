-- Tell one driver's DEVICES apart.
--
-- On 2026-08-15 a driver's status row alternated between app_version
-- 1.3.9 and 1.3.1, thirty-one seconds apart. That reads as a downgrade
-- and was diagnosed as one. It was not: she has TWO devices signed in as
-- the same driver, and mileage_device_status keeps exactly one row per
-- (driver, company), so each device silently overwrote the other. Every
-- reading of "her phone" that evening was whichever device beat last,
-- and there was no column that could have said so.
--
-- The same signature is visible earlier and was written off as noise: an
-- app_version of "1.0" sitting between 1.3.6 and 1.3.7 on 2026-08-04.
--
-- WHY THIS DOES NOT CHANGE THE PRIMARY KEY
--
-- The obvious fix, keying status on (driver, company, device), breaks
-- every reader:
--
--   lib/mileage/finalize.ts                  .maybeSingle()
--   app/api/cron/mileage-finalize/route.ts   .maybeSingle()
--
-- PostgREST errors when maybeSingle() matches more than one row, so the
-- tail-close decision and the stall alarm would both start failing for
-- exactly the multi-device drivers this is meant to help. A third reader,
-- lib/mileage/team-health.ts, builds a Map keyed by driver_user_id and
-- would silently keep an arbitrary device's row.
--
-- So the contract is unchanged: mileage_device_status stays "this
-- driver's latest word from ANY device". It just now says WHICH device
-- said it. Per-device history goes to mileage_device_heartbeats, which is
-- append-only and already the right shape for the question, and which is
-- where the 1.3.9-vs-1.3.1 alternation would have been obvious in one
-- GROUP BY.
--
-- device_id is a client-generated opaque id persisted in localStorage.
-- It is deliberately NOT a hardware identifier: both stores treat those
-- as fingerprinting, and the only question being asked is "same install
-- or a different one", which a random uuid answers completely. It
-- survives reloads and app restarts, and resets if the user clears site
-- data, which produces a new device rather than a wrong one.

alter table public.mileage_device_status
  add column if not exists device_id text;

alter table public.mileage_device_heartbeats
  add column if not exists device_id text;

comment on column public.mileage_device_status.device_id is
  'Opaque per-install id (localStorage), NOT a hardware identifier. The '
  'status row is still one per (driver, company): this names which device '
  'wrote it. For per-device history, group mileage_device_heartbeats.';

comment on column public.mileage_device_heartbeats.device_id is
  'Opaque per-install id. Group by (driver_user_id, device_id) to see one '
  'device timeline; without it two devices on one account are '
  'indistinguishable and read as a single device changing versions.';

-- The diagnostic query this exists to make possible: one driver's
-- devices, newest first. Partial index because device_id is null for
-- every row written before this migration and for any client that has
-- not yet shipped the id.
create index if not exists mileage_device_heartbeats_device_idx
  on public.mileage_device_heartbeats (driver_user_id, device_id, reported_at desc)
  where device_id is not null;
