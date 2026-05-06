-- Three additions in one migration:
--
-- 1. device_fingerprints — defends the 7-day free trial against
--    multi-account abuse. A server-side hash of (normalized IP +
--    user-agent + accept-language) is recorded the first time a
--    new user lands on the dashboard. If a different user signs up
--    later from the same fingerprint, their trial is revoked
--    (status flipped to 'active'/'free').
--
-- 2. categorization_rules — Bella's memory. Users teach the assistant
--    "every time you see ADOBE INC.SUB, that's a software expense"
--    and the rule fires for future imports without an Anthropic call.
--    Per-user OR per-company scope, ranked by hit count.
--
-- 3. profiles.active_platform — abelm@taxottic.com (added to
--    super_admins below) and other forever-admins can switch the app
--    "mode" from their profile: user (consumer dashboard), enterprise
--    (firms operations), or hq (super-admin ops). Non-admins
--    silently default to 'user'.

-- ----------------------------------------------------------------
-- Device fingerprints (trial fraud)
-- ----------------------------------------------------------------
create table if not exists public.device_fingerprints (
  id uuid primary key default gen_random_uuid(),
  device_hash text not null,
  ip_hash text,
  trial_consumed_user_id uuid references auth.users(id) on delete set null,
  trial_consumed_at timestamptz default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists device_fingerprints_hash_uniq
  on public.device_fingerprints (device_hash);
create index if not exists device_fingerprints_ip_idx
  on public.device_fingerprints (ip_hash);
create index if not exists device_fingerprints_user_idx
  on public.device_fingerprints (trial_consumed_user_id);

alter table public.device_fingerprints enable row level security;

drop policy if exists "device_fingerprints: super-admin only"
  on public.device_fingerprints;
create policy "device_fingerprints: super-admin only"
  on public.device_fingerprints for select
  using (public.is_super_admin());
-- No insert/update/delete policy → service-role only via the
-- trial-guard helper.

-- Stamp the trial_validated_at column on profiles so the lazy guard
-- knows when it last ran and can short-circuit.
alter table public.profiles
  add column if not exists trial_validated_at timestamptz;

-- ----------------------------------------------------------------
-- Bella categorization rules
-- ----------------------------------------------------------------
create table if not exists public.categorization_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- nullable: rules tied to a specific company beat global rules
  company_id uuid references public.companies(id) on delete cascade,
  pattern_type text not null
    check (pattern_type in ('exact', 'contains', 'starts_with')),
  pattern text not null,
  kind text not null
    check (kind in ('expense', 'income', 'ignore', 'transfer')),
  category_code text,
  notes text,
  hits int not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists categorization_rules_user_idx
  on public.categorization_rules (user_id);
create index if not exists categorization_rules_user_company_idx
  on public.categorization_rules (user_id, company_id);
create index if not exists categorization_rules_pattern_idx
  on public.categorization_rules (pattern);

alter table public.categorization_rules enable row level security;

drop policy if exists "categorization_rules: own read"
  on public.categorization_rules;
create policy "categorization_rules: own read"
  on public.categorization_rules for select
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "categorization_rules: own write"
  on public.categorization_rules;
create policy "categorization_rules: own write"
  on public.categorization_rules for insert
  with check (user_id = auth.uid());

drop policy if exists "categorization_rules: own update"
  on public.categorization_rules;
create policy "categorization_rules: own update"
  on public.categorization_rules for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "categorization_rules: own delete"
  on public.categorization_rules;
create policy "categorization_rules: own delete"
  on public.categorization_rules for delete
  using (user_id = auth.uid());

-- updated_at maintenance
drop trigger if exists categorization_rules_touch on public.categorization_rules;
create trigger categorization_rules_touch
  before update on public.categorization_rules
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------
-- Platform switcher
-- ----------------------------------------------------------------
alter table public.profiles
  add column if not exists active_platform text
    check (active_platform in ('user', 'enterprise', 'hq'));

-- ----------------------------------------------------------------
-- abelm@taxottic.com → forever super admin
-- ----------------------------------------------------------------
insert into public.super_admins (email) values ('abelm@taxottic.com')
on conflict (email) do nothing;
