-- Throttle state for the email fallback on tracker alerts.
--
-- WHY THIS COLUMN EXISTS.
--
-- On 2026-08-06 a driver's tracker degraded to foreground-only capture.
-- The detector caught it immediately and opened a `foreground_only`
-- episode. Nobody found out for five days, and six days of driving went
-- unrecorded, because the only delivery path was a push notification and
-- that driver's device had zero registered push tokens. Every send
-- failed, `notified_at` stayed NULL, `delivery_failed_at` was stamped,
-- and the row sat here describing the fault in its own `kind` column.
--
-- Manager escalation did fire, but escalation used push as well, so the
-- fallback shared the broken dependency with the thing it was falling
-- back from. Email shares nothing with push: no device token, no APNs
-- credential, no app install, no WebView.
--
-- `manager_emailed_at` throttles that email to once a day per driver
-- episode. Without it the finalizer would mail on every tick, because
-- the flag it would otherwise key on (`notified_at`) can never become
-- true for a driver nobody can reach. That is the same trap the
-- escalation gate already had to be fixed for.
--
-- Nullable and additive: existing rows read as "never emailed", which is
-- correct, and the first sweep after deploy will mail any episode that
-- is genuinely still open and still undelivered.

alter table public.mileage_tracker_alerts
  add column if not exists manager_emailed_at timestamptz;

comment on column public.mileage_tracker_alerts.manager_emailed_at is
  'Last time a manager was emailed about this undelivered episode. NULL means never. Throttles the email fallback used when the driver has no reachable push token.';

-- Partial index: the sweep only ever asks for live episodes the driver
-- was never told about, which is a small slice of the table.
create index if not exists mileage_tracker_alerts_undelivered_idx
  on public.mileage_tracker_alerts (company_id, stalled_since)
  where notified_at is null and stalled_since is not null;
