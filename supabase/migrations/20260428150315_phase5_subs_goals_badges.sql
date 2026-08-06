-- Recovered 20260428150315 (phase5_subs_goals_badges) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- ----------------------------------------------------------------------------
-- subscriptions: one row per (user, plan). Mirrors Stripe subscription state.
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.sub_plan as enum ('free', 'pro', 'team');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.sub_status as enum (
    'active',
    'trialing',
    'past_due',
    'canceled',
    'incomplete',
    'incomplete_expired',
    'unpaid',
    'paused'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan public.sub_plan not null default 'free',
  status public.sub_status not null default 'active',
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  trial_end timestamptz,
  updated_at timestamptz not null default now()
);

drop trigger if exists subs_touch on public.subscriptions;
create trigger subs_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

alter table public.subscriptions enable row level security;

drop policy if exists "subs: own read" on public.subscriptions;
create policy "subs: own read"
  on public.subscriptions for select
  using (user_id = auth.uid() or public.is_super_admin());

-- Inserts/updates only via service-role (webhook). No user-side write policy.

-- Helper: current user's plan (defaults to 'free' if no row).
create or replace function public.current_plan()
returns public.sub_plan
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select plan from public.subscriptions
       where user_id = auth.uid()
         and status in ('active', 'trialing'))
    , 'free'::public.sub_plan
  );
$$;

grant execute on function public.current_plan() to authenticated;

-- ----------------------------------------------------------------------------
-- goals: per-user (optionally per-company) savings goals
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.goal_type as enum (
    'tax_savings_total',
    'monthly_set_aside',
    'quarterly_payment',
    'deduction_capture',
    'custom'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  tax_year int not null,
  goal_type public.goal_type not null,
  title text not null,
  target_cents bigint not null check (target_cents >= 0),
  saved_cents bigint not null default 0,
  deadline date,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists goals_user_idx on public.goals (user_id, status);
create index if not exists goals_company_idx on public.goals (company_id, status);

drop trigger if exists goals_touch on public.goals;
create trigger goals_touch before update on public.goals
  for each row execute function public.touch_updated_at();

alter table public.goals enable row level security;
drop policy if exists "goals: own or member read" on public.goals;
create policy "goals: own or member read"
  on public.goals for select
  using (
    user_id = auth.uid()
    or (company_id is not null and public.is_company_member(company_id))
    or public.is_super_admin()
  );
drop policy if exists "goals: own write" on public.goals;
create policy "goals: own write"
  on public.goals for insert
  with check (user_id = auth.uid());
drop policy if exists "goals: own update" on public.goals;
create policy "goals: own update"
  on public.goals for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
drop policy if exists "goals: own delete" on public.goals;
create policy "goals: own delete"
  on public.goals for delete
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- reminders: in-app notifications surfaced to the user
-- ----------------------------------------------------------------------------
do $$ begin
  create type public.reminder_kind as enum (
    'q1_payment',
    'q2_payment',
    'q3_payment',
    'q4_payment',
    'extension_deadline',
    'filing_deadline',
    'monthly_set_aside',
    'goal_check_in',
    'custom'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  kind public.reminder_kind not null,
  title text not null,
  body text,
  due_at timestamptz not null,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists reminders_user_due_idx
  on public.reminders (user_id, due_at)
  where dismissed_at is null;

alter table public.reminders enable row level security;

drop policy if exists "reminders: own read" on public.reminders;
create policy "reminders: own read"
  on public.reminders for select
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "reminders: own update" on public.reminders;
create policy "reminders: own update"
  on public.reminders for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "reminders: own insert" on public.reminders;
create policy "reminders: own insert"
  on public.reminders for insert
  with check (user_id = auth.uid());

drop policy if exists "reminders: own delete" on public.reminders;
create policy "reminders: own delete"
  on public.reminders for delete
  using (user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- badges: rewards awarded to a user
-- ----------------------------------------------------------------------------
create table if not exists public.badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  badge_code text not null,
  awarded_at timestamptz not null default now(),
  context jsonb,
  unique (user_id, badge_code)
);
create index if not exists badges_user_idx on public.badges (user_id);

alter table public.badges enable row level security;

drop policy if exists "badges: own or company-mate read" on public.badges;
create policy "badges: own or company-mate read"
  on public.badges for select
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.company_members me
      join public.company_members them on them.company_id = me.company_id
      where me.user_id = auth.uid() and them.user_id = badges.user_id
    )
    or public.is_super_admin()
  );

drop policy if exists "badges: own insert" on public.badges;
create policy "badges: own insert"
  on public.badges for insert
  with check (user_id = auth.uid());

-- Auto-seed: every existing user starts on free plan
insert into public.subscriptions (user_id, plan, status)
  select id, 'free', 'active' from auth.users
on conflict (user_id) do nothing;

-- Trigger so new signups also get a free row
create or replace function public.handle_new_user_sub()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.subscriptions (user_id, plan, status)
  values (new.id, 'free', 'active')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_sub on auth.users;
create trigger on_auth_user_created_sub
after insert on auth.users
for each row execute function public.handle_new_user_sub();
