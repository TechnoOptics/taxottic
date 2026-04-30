-- Firm-level Stripe subscription metadata. Mirrors the user-level
-- `subscriptions` table but keyed by firm. Stripe customer + sub IDs
-- come from a Stripe webhook handler we'll wire next; for now we
-- have a place to store them.

create table if not exists public.firm_subscriptions (
  firm_id uuid primary key references public.firms(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text,
  tier public.firm_tier not null default 'starter',
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists firm_subscriptions_status_idx
  on public.firm_subscriptions (status);
create index if not exists firm_subscriptions_stripe_sub_idx
  on public.firm_subscriptions (stripe_subscription_id);

alter table public.firm_subscriptions enable row level security;

drop policy if exists "fs: firm member read" on public.firm_subscriptions;
create policy "fs: firm member read"
  on public.firm_subscriptions for select
  using (public.is_firm_member(firm_id) or public.is_super_admin());

alter table public.firms
  add column if not exists onboarded_clients_this_month int not null default 0;
