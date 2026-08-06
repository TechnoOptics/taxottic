-- Recovered 20260428152519 (phase6_passkeys) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.passkeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,                          -- denormalized for credential discovery on sign-in
  credential_id text not null unique,           -- base64url-encoded WebAuthn credential ID
  public_key bytea not null,                    -- COSE-encoded public key
  counter bigint not null default 0,
  transports text[],                            -- e.g. ['internal', 'hybrid']
  device_type text,                             -- 'singleDevice' | 'multiDevice'
  backed_up boolean not null default false,
  friendly_name text,                           -- user-named device label
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists passkeys_user_idx on public.passkeys (user_id);
create index if not exists passkeys_email_idx on public.passkeys (lower(email));

alter table public.passkeys enable row level security;

drop policy if exists "passkeys: own read" on public.passkeys;
create policy "passkeys: own read"
  on public.passkeys for select
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "passkeys: own delete" on public.passkeys;
create policy "passkeys: own delete"
  on public.passkeys for delete
  using (user_id = auth.uid());

-- Inserts/updates only happen via service role (server endpoints with service-role key).
-- Service role bypasses RLS, so no insert policy needed.

-- RPC for sign-in flow: lookup credentials by email (case-insensitive). Used
-- before the user is signed in, so it has to use security definer.
create or replace function public.passkey_lookup_by_email(p_email text)
returns table (
  id uuid,
  user_id uuid,
  credential_id text,
  public_key bytea,
  counter bigint,
  transports text[]
)
language sql
stable
security definer
set search_path = public
as $$
  select id, user_id, credential_id, public_key, counter, transports
  from public.passkeys
  where lower(email) = lower(p_email);
$$;

grant execute on function public.passkey_lookup_by_email(text) to anon, authenticated;
