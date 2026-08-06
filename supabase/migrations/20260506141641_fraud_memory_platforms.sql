-- Recovered 20260506141641 (fraud_memory_platforms) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.device_fingerprints (
  id uuid primary key default gen_random_uuid(),
  device_hash text not null,
  ip_hash text,
  trial_consumed_user_id uuid references auth.users(id) on delete set null,
  trial_consumed_at timestamptz default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists device_fingerprints_hash_uniq on public.device_fingerprints (device_hash);
create index if not exists device_fingerprints_ip_idx on public.device_fingerprints (ip_hash);
create index if not exists device_fingerprints_user_idx on public.device_fingerprints (trial_consumed_user_id);
alter table public.device_fingerprints enable row level security;
drop policy if exists "device_fingerprints: super-admin only" on public.device_fingerprints;
create policy "device_fingerprints: super-admin only" on public.device_fingerprints for select using (public.is_super_admin());

alter table public.profiles add column if not exists trial_validated_at timestamptz;

create table if not exists public.categorization_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  pattern_type text not null check (pattern_type in ('exact', 'contains', 'starts_with')),
  pattern text not null,
  kind text not null check (kind in ('expense', 'income', 'ignore', 'transfer')),
  category_code text,
  notes text,
  hits int not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists categorization_rules_user_idx on public.categorization_rules (user_id);
create index if not exists categorization_rules_user_company_idx on public.categorization_rules (user_id, company_id);
create index if not exists categorization_rules_pattern_idx on public.categorization_rules (pattern);
alter table public.categorization_rules enable row level security;
drop policy if exists "categorization_rules: own read" on public.categorization_rules;
create policy "categorization_rules: own read" on public.categorization_rules for select using (user_id = auth.uid() or public.is_super_admin());
drop policy if exists "categorization_rules: own write" on public.categorization_rules;
create policy "categorization_rules: own write" on public.categorization_rules for insert with check (user_id = auth.uid());
drop policy if exists "categorization_rules: own update" on public.categorization_rules;
create policy "categorization_rules: own update" on public.categorization_rules for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "categorization_rules: own delete" on public.categorization_rules;
create policy "categorization_rules: own delete" on public.categorization_rules for delete using (user_id = auth.uid());
drop trigger if exists categorization_rules_touch on public.categorization_rules;
create trigger categorization_rules_touch before update on public.categorization_rules for each row execute function public.touch_updated_at();

alter table public.profiles add column if not exists active_platform text check (active_platform in ('user', 'enterprise', 'hq'));

insert into public.super_admins (email) values ('abelm@taxottic.com') on conflict (email) do nothing;
