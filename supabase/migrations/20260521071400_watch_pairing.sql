-- Recovered 20260521071400 (watch_pairing) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Watch ↔ account pairing tables. The repo's 20260514000019 migration
-- was never applied; without these tables every /api/watch/pair/*
-- call fails. Idempotent (create table if not exists), so reapplying
-- on top of a fresh dev DB is a no-op.

create table if not exists public.watch_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  token_hash text,
  pending_token text,
  label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  revoked_at timestamptz
);

create unique index if not exists watch_devices_token_hash_uniq
  on public.watch_devices (token_hash) where token_hash is not null;
create index if not exists watch_devices_user_active_idx
  on public.watch_devices (user_id) where revoked_at is null;

create table if not exists public.watch_pair_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  device_id uuid not null
    references public.watch_devices(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);

create index if not exists watch_pair_codes_device_idx
  on public.watch_pair_codes (device_id);
create index if not exists watch_pair_codes_expiry_idx
  on public.watch_pair_codes (expires_at) where consumed_at is null;

alter table public.watch_devices enable row level security;
alter table public.watch_pair_codes enable row level security;
-- Service-role only. No policies on purpose: API routes are the sole
-- reader/writer; the watch authenticates by bearer token, the phone
-- by session.;
