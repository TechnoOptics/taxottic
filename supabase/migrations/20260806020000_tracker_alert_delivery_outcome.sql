-- Record whether a stall alert actually REACHED the driver.
--
-- mileage_tracker_alerts.notified_at was stamped unconditionally, right
-- after the notify() call, without looking at what notify() returned.
-- So a driver with no row in device_tokens looked notified forever: the
-- episode read as handled, and the 24h re-notify kept refreshing the
-- timestamp so even the age of the claim looked healthy.
--
-- Measured: an iOS device went silent 2026-08-04 23:24 UTC and stayed
-- dark for 42 hours. The alert row said notified_at = 2026-08-06 02:30.
-- The driver has never had a device token, so nothing was ever sent.
-- The alerting was not broken; its bookkeeping was lying to us.
--
-- notified_at now means "we reached them" and nothing else. These two
-- columns carry the other outcomes so a failure is visible rather than
-- indistinguishable from success.
alter table public.mileage_tracker_alerts
  add column if not exists delivery_failed_at timestamptz,
  add column if not exists escalated_at timestamptz;

comment on column public.mileage_tracker_alerts.notified_at is
  'When the DRIVER was actually reached (push delivered > 0). NULL while an episode is open and undeliverable, which is what keeps the sweep retrying instead of going quiet.';

comment on column public.mileage_tracker_alerts.delivery_failed_at is
  'Last attempt that reached nobody: no registered device, or every token failed. Also throttles the retry to hourly, since a NULL notified_at would otherwise re-attempt every 10-minute tick.';

comment on column public.mileage_tracker_alerts.escalated_at is
  'When a manager was told instead, because the driver could not be reached. The channel of last resort: an unreachable driver is invisible to the in-app banner (needs the app open) and to push (needs a registered device).';
