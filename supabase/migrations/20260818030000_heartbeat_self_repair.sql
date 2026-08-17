-- Somewhere to record that the device tried to FIX itself, not just that
-- it noticed it was broken.
--
-- Step B of docs/design/self-healing-capture.md. Step A taught the
-- finalize cron to escalate on a self_check `dead=` verdict. This is the
-- device acting on two of those verdicts by itself: re-arming a
-- learned-place geofence mesh whose registration failed, and re-asking
-- for Always location when the OS can still raise a dialog.
--
-- WHY OBSERVABILITY IS THE DELIVERABLE AND NOT A NICE-TO-HAVE
--
-- The failure mode this repo produces most often is BUILT BUT DEAD: the
-- code ships, type-checks, looks right, and never runs. Three features
-- died that way inside one week, and every symptom was a null column,
-- which reads as "no data yet" and gets skipped. A self-repairer is a
-- particularly good candidate for it, because when it works there is
-- nothing to see: the fault is gone, which is exactly what a repairer
-- that never ran also produces on a device that was never broken.
--
-- The second hazard is the opposite one. A repair that retries forever
-- burns battery and manufactures noise, and a supervisor restarting a
-- service that immediately dies is worse than no supervisor at all. So
-- the attempt cap is not merely enforced, it is REPORTED: a device that
-- has given up says `<id>:capped` rather than falling silent.
--
-- Two columns, because one cannot answer all three questions:
--
--   self_repair           what happened on THIS beat
--   self_repair_attempts  how many attempts this install has EVER made,
--                         which survives both a successful repair and a
--                         page reload
--
-- self_repair vocabulary, one `<id>:<state>` segment per non-idle id,
-- comma joined, or 'none':
--
--   ok        the repair ran this beat and reported success
--   prompted  an OS permission dialog was raised; the answer belongs to
--             the driver, minutes from now, so success is not claimed
--   failed    the repair ran this beat and reported failure
--   healed    the fault being repaired is GONE. The only value that
--             proves a repair actually worked
--   capped    the fault is still here and the repairer has given up
--   waiting   the fault is still here, backoff has not elapsed
--   driving   the fault is still here and a drive is in flight, so the
--             repairer stood down rather than touch the capture path
--
-- The three questions this has to answer from one query:
--
--   select self_repair,
--          count(*)                        as beats,
--          count(distinct driver_user_id)  as drivers,
--          max(self_repair_attempts)       as most_attempts_by_one_install
--   from public.mileage_device_heartbeats
--   where reported_at > now() - interval '7 days'
--     and self_repair is not null
--     and self_repair <> 'none'
--   group by 1
--   order by 2 desc;
--
-- Reading it:
--
--   nothing at all but 'none'      either no device is faulty, or the
--                                  repairer is not running. Cross-check
--                                  against self_check like 'dead=%':
--                                  dead verdicts with no self_repair
--                                  rows is the INERT signature.
--   %:healed rows                  repairs are working. This is the row
--                                  the whole change exists to produce.
--   %:capped with real drivers     the alarm. The repair cannot fix
--                                  what is wrong on those handsets and
--                                  it needs a human.
--   %:waiting only, never ok       backoff is blocking every attempt,
--                                  i.e. the beat cadence and the
--                                  backoff are mis-tuned.
--   %:driving only                 the drive gate is stuck on. Nothing
--                                  would ever be repaired.
--
-- The `self_repair is not null` filter matters: every phone still on the
-- pre-v193 bundle sends nothing here and would otherwise dilute the
-- reading until its WebView cache turns over.
--
-- BOTH TABLES, ALWAYS. app/api/mileage/heartbeat/route.ts builds ONE
-- payload and upserts it into mileage_device_status first, returning 500
-- on error before the history append. A column present on only
-- mileage_device_heartbeats does not degrade the heartbeat, it deletes
-- it, for every device on both platforms, silently. That has already
-- happened here with arm_interrupted_at, web_build and eight car_*
-- columns. Guarded by lib/db/schema-contract.test.ts.
--
-- Purely additive and nullable.

alter table public.mileage_device_status
  add column if not exists self_repair          text,
  add column if not exists self_repair_attempts integer;

alter table public.mileage_device_heartbeats
  add column if not exists self_repair          text,
  add column if not exists self_repair_attempts integer;

comment on column public.mileage_device_status.self_repair is
  'What the device-side repairer did on this beat, as comma-joined <capability>:<state> segments, or none. States: ok, prompted, failed, healed, capped, waiting, driving. healed is the only value that proves a repair worked; capped is the repairer reporting that it has given up.';

comment on column public.mileage_device_heartbeats.self_repair is
  'What the device-side repairer did on this beat, as comma-joined <capability>:<state> segments, or none. States: ok, prompted, failed, healed, capped, waiting, driving. healed is the only value that proves a repair worked; capped is the repairer reporting that it has given up.';

comment on column public.mileage_device_status.self_repair_attempts is
  'Repair attempts this install has ever made, across all capabilities. Never reset by a successful repair, so it separates a device that healed itself from one that never needed to.';

comment on column public.mileage_device_heartbeats.self_repair_attempts is
  'Repair attempts this install has ever made, across all capabilities. Never reset by a successful repair, so it separates a device that healed itself from one that never needed to.';

-- The alarm path: devices that have given up. Partial, so it costs
-- nothing on the overwhelming majority of rows that say 'none'.
create index if not exists mileage_device_status_self_repair_capped_idx
  on public.mileage_device_status (reported_at desc)
  where self_repair like '%:capped%';
