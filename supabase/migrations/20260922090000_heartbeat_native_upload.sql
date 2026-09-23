-- Somewhere to record what the NATIVE uploader did, as opposed to the
-- JavaScript drain.
--
-- native_drain_trigger and native_drain_points (20260817020000) can only
-- ever describe an app that was ALIVE: they are written by the WebView
-- as it drains the on-disk buffer. The hours nobody has any evidence
-- about are the hours the app is dead, and that is where the latency
-- lives. Measured over 21 days on the reporting phone, the median GPS
-- fix reached the server 24 hours after capture and p90 was 5.9 days,
-- because the only uploader in the product was that flush tick and the
-- OS kills this app nightly.
--
-- The Android capture service now posts its own buffer
-- (TaxotticUploader, called from TaxotticResurrectionService at exactly
-- two moments: a capture ending, and a cold start that finds a backlog).
-- These three columns are how anyone finds out whether that worked.
--
-- WHY THE REASON COLUMN IS THE IMPORTANT ONE.
--
-- The uploader runs in a process started cold by a geofence receiver,
-- which has never created a WebView. Whether
-- CookieManager.getInstance().getCookie(origin) returns the Supabase
-- session cookie in that process is not decidable off a phone, and if it
-- does not, every run refuses with 'no_session', posts nothing, and the
-- p90 does not move at all. From every other column in this table that
-- device looks perfectly healthy: it is armed, it captures fixes, it
-- heartbeats. native_upload_reason is the only place the difference
-- shows.
--
-- The vocabulary is TaxotticUploader.Result's, verbatim:
--   ok          posted and consumed
--   no_config   no origin or company id pushed down yet
--   no_session  no sb- cookie in this process        <- the risk above
--   bad_origin  origin is not http(s), e.g. capacitor://localhost
--   empty       nothing buffered
--   http_<code> the server refused, code included
--   io_error    the POST threw, or the payload would not build
--
-- The question to run within a day of the build reaching a phone:
--
--   select native_upload_reason, native_upload_trigger, count(*),
--          max(native_upload_points), max(geofence_buffered_fixes)
--   from public.mileage_device_heartbeats
--   where reported_at > now() - interval '2 days'
--     and native_upload_reason is not null
--   group by 1, 2 order by 3 desc;
--
-- 'ok' with points moving means the native uploader is live. Only
-- 'no_session' means it is built, called, and useless, and the fix is a
-- native HTTP path that carries the token itself rather than borrowing
-- the WebView's cookie jar. All three nullable: NULL is a device that
-- has not attempted a native upload since the new build, which is every
-- device until its next geofence exit.

alter table public.mileage_device_status
  add column if not exists native_upload_reason  text,
  add column if not exists native_upload_trigger text,
  add column if not exists native_upload_points  integer;

alter table public.mileage_device_heartbeats
  add column if not exists native_upload_reason  text,
  add column if not exists native_upload_trigger text,
  add column if not exists native_upload_points  integer;

comment on column public.mileage_device_heartbeats.native_upload_reason is
  'Outcome of the last upload the Android capture service attempted with no JS running: ok | no_config | no_session | bad_origin | empty | http_<code> | io_error. Read this before the count. "no_session" means the cold-started process has no Supabase cookie, which makes the native uploader inert while every other column stays healthy.';

comment on column public.mileage_device_heartbeats.native_upload_trigger is
  'Which of the two call sites ran it: capture_ended | cold_start_backlog. There is no timer. A null trigger with a non-null reason would mean a third call site appeared.';

comment on column public.mileage_device_heartbeats.native_upload_points is
  'Fixes that upload posted and consumed. 0 under reason "empty" is a healthy idle service; 0 under "no_session" is the failure this column set exists to expose.';
