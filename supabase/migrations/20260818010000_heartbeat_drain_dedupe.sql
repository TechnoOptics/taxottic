-- Somewhere to record whether the native-buffer duplicate suppression is
-- actually working, rather than merely present.
--
-- THE DEFECT IT WATCHES. Both native buffers hold the SAME fix stream,
-- and the drain coordinator posted both. Two ingest POSTs 0.618 s apart,
-- each carrying exactly 1630 points, all 1630 pairs coordinate-identical
-- and offset by exactly 0.6310 s with standard deviation 0.0000. Ingest
-- is idempotent on (driver_user_id, company_id, captured_at) and 631 ms
-- is not a conflict, so both copies stored; merged with the live stream
-- the pool held 1263 of 3351 transitions above 60 m/s, worst about
-- 88783 m/s, and segmented to one 1527 mile / 25 minute trip that
-- isPlausibleTrip correctly refused. The drive never appeared.
--
-- WHY A COUNTER AT ALL, AND WHY TWO.
--
-- The suppression keys on the EXACT coordinate: bit-identical latitude
-- and longitude, because a moving receiver does not emit the same IEEE
-- double twice. If a future native build ever stored its coordinates at
-- a different precision, the check would match nothing, suppress
-- nothing, and every other signal in this subsystem would stay healthy.
-- Live native_drain_trigger, points still moving, no errors. The fix
-- would be inert and no row would say so. That failure shape, present
-- but never actually doing anything, is this codebase's most common one.
--
-- native_drain_suppressed alone cannot carry it, because 0 has two
-- opposite meanings. native_drain_checked separates them by counting
-- only the fixes weighed against a coverage set that COULD have matched:
-- a sibling batch the server confirmed, for the same company.
--
--   trigger is null                  the drain path never ran
--   checked > 0 and suppressed > 0   suppression is WORKING
--   checked > 0 and suppressed = 0   both buffers held fixes and nothing
--                                    matched. This is the inert state.
--   checked = 0                      no opportunity. Proves nothing.
--
-- The question a reviewer runs after this ships:
--
--   select case
--            when native_drain_trigger is null then 'c_drain_never_ran'
--            when native_drain_checked > 0 and native_drain_suppressed > 0
--              then 'a_working'
--            when native_drain_checked > 0 then 'b_INERT_nothing_matched'
--            else 'no_opportunity'
--          end as state,
--          count(*) as rows,
--          count(distinct driver_user_id) as drivers,
--          sum(native_drain_suppressed) as fixes_suppressed
--   from public.mileage_device_heartbeats
--   where reported_at > now() - interval '2 days'
--     and native_drain_checked is not null
--   group by 1 order by 2 desc;
--
-- b_INERT_nothing_matched with a real driver count is the alarm. Note
-- the native_drain_checked is not null filter: without it every phone
-- still on the pre-v191 bundle lands in no_opportunity and dilutes the
-- reading until the WebView cache turns over.
--
-- BOTH TABLES, ALWAYS. app/api/mileage/heartbeat/route.ts builds ONE
-- payload and upserts it into mileage_device_status first, returning 500
-- on error before the history append. A column present on only
-- mileage_device_heartbeats does not degrade the heartbeat, it deletes
-- it, for every device on both platforms, silently. That has already
-- happened here with arm_interrupted_at, web_build and eight car_*
-- columns. Guarded by lib/db/schema-contract.test.ts and by
-- lib/mileage/native-drain-wiring.test.ts.
--
-- Purely additive and nullable. NULL means a client predating these
-- columns, which is every phone until its WebView picks up the new
-- bundle, and is exactly why the reader filters on not null.

alter table public.mileage_device_status
  add column if not exists native_drain_checked    integer,
  add column if not exists native_drain_suppressed integer;

alter table public.mileage_device_heartbeats
  add column if not exists native_drain_checked    integer,
  add column if not exists native_drain_suppressed integer;

comment on column public.mileage_device_heartbeats.native_drain_checked is
  'Fixes the second native buffer offered to the duplicate check while a server-confirmed sibling batch existed, for the same company, to check them against. 0 means the mechanism had no opportunity in that pass and proves nothing either way. Read BEFORE native_drain_suppressed.';

comment on column public.mileage_device_heartbeats.native_drain_suppressed is
  'Of those checked, how many the sibling batch already held and were therefore not posted a second time. checked > 0 with suppressed = 0 is the inert signature: both native buffers held fixes and the coordinate identity matched none of them.';
