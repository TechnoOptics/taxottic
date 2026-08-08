-- Record when a device's arm sequence was started and never finished.
--
-- startMileageTracking arms the native tracker with stop-then-start: it
-- tears down any orphaned background service, then starts a fresh one.
-- The stop is mandatory (it is the fix for the Android ALREADY_STARTED
-- bug where a surviving service keeps an orphaned callback), but it means
-- the service is DOWN for the duration of the sequence.
--
-- If the JS context dies at the await in between (a backgrounded iOS
-- WebView suspended by the OS, an Android process kill, a page reload)
-- the service stays down and nothing restarts it. The UI still reads
-- "tracking on", and the device still heartbeats whenever the app is
-- opened, so from the server this is indistinguishable from a phone that
-- is simply parked. That ambiguity is how a real device lost four days of
-- drives in August 2026 without a single alarm firing.
--
-- The client stamps a latch before the stop and clears it after the start
-- returns (lib/mileage/arm-latch.ts). A latch that survives is proof the
-- sequence was interrupted, and this column is where that proof lands so
-- it can be queried rather than guessed at.
--
-- Nullable with no default: NULL means "no interrupted arm", which is the
-- correct reading for every existing row and for any client too old to
-- send the field.

alter table public.mileage_device_heartbeats
  add column if not exists arm_interrupted_at timestamptz;

comment on column public.mileage_device_heartbeats.arm_interrupted_at is
  'When a stop-then-start arm sequence began and never completed, leaving the background location service down. NULL means no interrupted arm. See lib/mileage/arm-latch.ts.';
