-- Idempotent raw-point ingest.
--
-- Two real problems, one fix:
--
-- 1. The device flush retries whenever a POST doesn't return 2xx. If the
--    insert SUCCEEDED server-side but the response was lost (dead zone,
--    tunnel, backgrounded mid-request — routine on a phone in a car),
--    the client keeps the batch and re-sends it. Nothing stopped the
--    same fix from being stored twice, inflating raw storage and
--    feeding duplicate timestamps into segmentation.
--
-- 2. It blocks a second capture path. iOS needs one (the WebView is not
--    reliably alive in the background), and two paths WILL overlap.
--
-- A single device cannot legitimately produce two distinct fixes for the
-- same driver+company at the same instant, so (driver, company,
-- captured_at) is a natural identity. Duplicates are dropped at the door
-- via ON CONFLICT DO NOTHING rather than deduped later at render.
--
-- Dedupe existing rows first (keep the best-accuracy row per identity,
-- and among ties the earliest id) so the unique index can be created.
with ranked as (
  select id,
    row_number() over (
      partition by driver_user_id, company_id, captured_at
      -- Prefer a row the finalizer has ALREADY consumed: dropping a
      -- consumed row in favour of an unconsumed twin would re-feed that
      -- instant to segmentation. Then best accuracy, then oldest id.
      order by (consumed_at is null) asc,
               coalesce(accuracy_m, 1e9) asc,
               id asc
    ) as rn
  from public.mileage_points_raw
)
delete from public.mileage_points_raw p
using ranked r
where p.id = r.id and r.rn > 1;

create unique index if not exists mileage_points_raw_identity_uq
  on public.mileage_points_raw (driver_user_id, company_id, captured_at);
