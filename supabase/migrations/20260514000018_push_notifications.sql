-- Push delivery backend (Watch & notifications spec, Phase 1).
--
-- Two tables, both additive and RLS-scoped to the owning user:
--
--   device_tokens   — one row per (user, push token). The client
--                     captures the APNs/FCM token on registration
--                     and upserts here; the server send path reads
--                     every live token for a user and fans out.
--   notification_log — idempotency + audit. A unique (user_id,
--                     dedupe_key) makes "send this once" a cheap
--                     insert-or-skip, the same discipline as the
--                     reminder-dedupe / firm-activity work. Also a
--                     forensic record of what we sent.
--
-- No event producers are wired yet (spec Phase 3) and no native
-- categories (Phase 2); this is just the pipe + storage so the rest
-- is built on something proven.

create type push_platform as enum ('ios', 'android', 'web');

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform push_platform not null,
  token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  -- Set when APNs/FCM reports the token is dead, or on sign-out.
  -- Send path filters these out; we keep the row for audit.
  revoked_at timestamptz
);

-- A device re-registers the same token on every cold start; the
-- client upserts on this so we refresh last_seen_at instead of
-- piling up duplicates.
create unique index if not exists device_tokens_user_token_uniq
  on public.device_tokens (user_id, token);
create index if not exists device_tokens_user_active_idx
  on public.device_tokens (user_id) where revoked_at is null;

alter table public.device_tokens enable row level security;

-- A user sees/manages only their own tokens. Writes from route
-- handlers go through the service-role client (the codebase's
-- standard pattern — @supabase/ssr cookies don't reach PostgREST in
-- a route handler), which bypasses RLS; these policies cover any
-- direct session-client access and make the table safe-by-default.
drop policy if exists "device_tokens: own select" on public.device_tokens;
create policy "device_tokens: own select"
  on public.device_tokens for select
  using (user_id = auth.uid());

drop policy if exists "device_tokens: own insert" on public.device_tokens;
create policy "device_tokens: own insert"
  on public.device_tokens for insert
  with check (user_id = auth.uid());

drop policy if exists "device_tokens: own update" on public.device_tokens;
create policy "device_tokens: own update"
  on public.device_tokens for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "device_tokens: own delete" on public.device_tokens;
create policy "device_tokens: own delete"
  on public.device_tokens for delete
  using (user_id = auth.uid());

create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  -- Stable per logical event (e.g. "trip_classify:<tripId>") so a
  -- retried/duplicated producer can't double-notify.
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now()
);

create unique index if not exists notification_log_dedupe_uniq
  on public.notification_log (user_id, dedupe_key);

alter table public.notification_log enable row level security;

-- Read-only to the owner (a future in-app "notification history"
-- view); all writes are service-role from the send path.
drop policy if exists "notification_log: own select" on public.notification_log;
create policy "notification_log: own select"
  on public.notification_log for select
  using (user_id = auth.uid());

comment on table public.device_tokens is
  'APNs/FCM/web-push tokens per user. Send path reads where revoked_at is null.';
comment on table public.notification_log is
  'One row per delivered logical notification; (user_id, dedupe_key) unique = idempotency + audit.';
