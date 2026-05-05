-- Credits ledger: append-only log of every credit event. Balance is
-- always derived as SUM(delta_credits) for a user; never stored
-- standalone, so divergence between balance and history is impossible.
--
-- Event kinds:
--   monthly_grant       positive   credits granted at billing-cycle rollover
--   topup_purchase      positive   credits bought via Stripe checkout
--   rollover_expiry     negative   monthly-credit overflow trimmed to 2× cap
--   consume_<action>    negative   credits burned by a user-facing action
--   refund              positive   manual admin restore (rare)
--
-- The migration also adds top-up tracking to subscriptions:
--   topups_this_period_credits     int       sum of top-ups since last grant
--   auto_topup_pack                text      'boost' | 'stack' | 'bundle' | 'power' | null
--   auto_topup_threshold_credits   int       balance below which we auto-buy
--   last_credit_grant_at           timestamptz  when monthly_grant last fired

create table if not exists public.credits_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta_credits int not null,
  reason text not null,
  -- Optional pointer to the Stripe charge / subscription / OCR row that
  -- produced this entry. Free-form so the schema doesn't have to know
  -- about every downstream table.
  ref_id text,
  created_at timestamptz not null default now()
);

create index if not exists credits_ledger_user_created_idx
  on public.credits_ledger (user_id, created_at desc);
create index if not exists credits_ledger_user_reason_idx
  on public.credits_ledger (user_id, reason);

-- RLS: users can read their own ledger entries. Inserts are
-- service-role only — every credit change must go through the engine
-- in lib/plans/credits.ts so the running balance stays consistent.
alter table public.credits_ledger enable row level security;

drop policy if exists "credits_ledger: own read" on public.credits_ledger;
create policy "credits_ledger: own read"
  on public.credits_ledger for select
  using (user_id = auth.uid() or public.is_super_admin());

-- Subscription top-up + auto-topup state
alter table public.subscriptions
  add column if not exists topups_this_period_credits int not null default 0;
alter table public.subscriptions
  add column if not exists auto_topup_pack text
    check (auto_topup_pack in ('boost', 'stack', 'bundle', 'power'));
alter table public.subscriptions
  add column if not exists auto_topup_threshold_credits int;
alter table public.subscriptions
  add column if not exists last_credit_grant_at timestamptz;

-- Server-side balance helper. Returns SUM(delta_credits), 0 if none.
create or replace function public.credit_balance(p_user_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(delta_credits), 0)::int
  from public.credits_ledger
  where user_id = p_user_id;
$$;

grant execute on function public.credit_balance(uuid) to authenticated;
