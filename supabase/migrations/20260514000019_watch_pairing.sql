-- Watch ↔ account QR pairing (Watch spec, pairing phase).
--
-- Flow (no credentials ever leave the account, nothing scannable is
-- a secret for longer than ~2 min):
--
--   1. The watch, when it has no bound token, calls
--      POST /api/watch/pair/start → server creates a watch_devices
--      row (user_id null) + a watch_pair_codes row holding the
--      SHA-256 of a short random code with a ~120s TTL. The plaintext
--      code is returned ONCE and rendered as the QR.
--   2. The signed-in phone scans it and calls
--      POST /api/watch/pair/redeem { code } → server validates the
--      code (exists, unexpired, unconsumed), binds the device to the
--      session user, mints a 256-bit watch token, stores only its
--      SHA-256, and parks the plaintext in pending_token for a single
--      delivery. The code is marked consumed.
--   3. The watch polls GET /api/watch/pair/poll?deviceId=… → once
--      bound it receives the token exactly once (pending_token is
--      cleared on read) and stores it. From then on it pulls its
--      snapshot directly with `Authorization: Bearer <token>` and
--      falls back to the phone Data-Layer bridge when offline.
--
-- Both tables are service-role only (RLS enabled, NO policies): the
-- server is the sole reader/writer; clients never touch them
-- directly. Same locked-down discipline as the push backend.

create table if not exists public.watch_devices (
  id uuid primary key default gen_random_uuid(),
  -- Null until a phone redeems a code for this device.
  user_id uuid references public.profiles(id) on delete cascade,
  -- SHA-256(hex) of the long-lived watch bearer token. The plaintext
  -- token is never stored. Null until redeemed.
  token_hash text,
  -- One-time plaintext hand-off of a freshly minted token to the
  -- watch via /pair/poll. Cleared the instant the watch reads it, so
  -- it only exists for the seconds between redeem and the next poll.
  pending_token text,
  label text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  -- Set to revoke the device (unpair). Auth path filters these out.
  revoked_at timestamptz
);

create unique index if not exists watch_devices_token_hash_uniq
  on public.watch_devices (token_hash) where token_hash is not null;
create index if not exists watch_devices_user_active_idx
  on public.watch_devices (user_id) where revoked_at is null;

create table if not exists public.watch_pair_codes (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256(hex) of the short code shown in the QR. Never the
  -- plaintext: a leaked DB row can't be replayed as a scan.
  code_hash text not null unique,
  device_id uuid not null
    references public.watch_devices(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- ~120s after creation; the redeem path rejects anything older.
  expires_at timestamptz not null,
  -- Single-use: set on first successful redeem.
  consumed_at timestamptz
);

create index if not exists watch_pair_codes_device_idx
  on public.watch_pair_codes (device_id);
create index if not exists watch_pair_codes_expiry_idx
  on public.watch_pair_codes (expires_at) where consumed_at is null;

alter table public.watch_devices enable row level security;
alter table public.watch_pair_codes enable row level security;
-- Intentionally NO policies. Only the service role (the API routes)
-- reads or writes these; the watch authenticates by token possession
-- and the phone by its session — never by direct table access.
