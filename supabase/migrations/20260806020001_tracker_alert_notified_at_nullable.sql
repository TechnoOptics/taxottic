-- Let notified_at be NULL, because "we never reached them" is now a
-- state this column has to be able to express.
--
-- 20260806020000 redefined notified_at to mean "the driver was actually
-- reached" and left NULL for an open, undeliverable episode. The column
-- was still NOT NULL from its original design, where the value was
-- stamped unconditionally right after the notify() call and therefore
-- could never be absent. Writing NULL against that constraint raises
-- 23502 and aborts the upsert, which would have made the stall sweep
-- throw on exactly the drivers the change exists to protect.
--
-- Caught before merge by attempting the write against production.
alter table public.mileage_tracker_alerts
  alter column notified_at drop not null;
