-- Recovered 20260516062637 (push_notifications) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create type push_platform as enum ('ios', 'android', 'web');

create table if not exists public.device_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform push_platform not null,
  token text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index if not exists device_tokens_user_token_uniq
  on public.device_tokens (user_id, token);
create index if not exists device_tokens_user_active_idx
  on public.device_tokens (user_id) where revoked_at is null;

alter table public.device_tokens enable row level security;

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
  dedupe_key text not null,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz not null default now()
);

create unique index if not exists notification_log_dedupe_uniq
  on public.notification_log (user_id, dedupe_key);

alter table public.notification_log enable row level security;

drop policy if exists "notification_log: own select" on public.notification_log;
create policy "notification_log: own select"
  on public.notification_log for select
  using (user_id = auth.uid());

comment on table public.device_tokens is
  'APNs/FCM/web-push tokens per user. Send path reads where revoked_at is null.';
comment on table public.notification_log is
  'One row per delivered logical notification; (user_id, dedupe_key) unique = idempotency + audit.';
