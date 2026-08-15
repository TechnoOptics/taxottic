-- Throttle state for the "you have drives to confirm" reminder.
--
-- WHY THIS COLUMN EXISTS.
--
-- Ten drives were sitting unconfirmed in production, the oldest for
-- seventeen days, across two drivers. Neither had ever been told,
-- because the only reminder channel was push and there are ZERO iOS
-- push tokens: the notification fired into nothing and the system
-- recorded a send.
--
-- The email reminder that replaces it needs to know when it last wrote
-- to a driver, or it would mail on every cron tick. It cannot key on
-- needs_confirmation, since that flag stays true precisely while the
-- driver has not acted, which is the whole period we are throttling.
--
-- Per TRIP rather than per driver so the sweep can throttle on
-- max(confirmation_reminded_at) across a driver's pending drives. A
-- driver who accumulates new drives daily then still gets one message
-- every few days, instead of one per newly-arrived drive.
--
-- Nullable and additive. Existing rows read as "never reminded", which
-- is true, so the first sweep after deploy picks up the real backlog.

alter table public.mileage_trips
  add column if not exists confirmation_reminded_at timestamptz;

comment on column public.mileage_trips.confirmation_reminded_at is
  'Last time the driver was emailed about confirming this drive. NULL means never. Throttles the reminder sweep; see lib/mileage/unconfirmed-drives.ts.';

-- The sweep only ever asks for drives still awaiting confirmation,
-- which is a small slice of the table.
create index if not exists mileage_trips_needs_confirmation_idx
  on public.mileage_trips (driver_user_id, started_at)
  where needs_confirmation;
