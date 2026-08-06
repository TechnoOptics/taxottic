-- Recovered 20260430160337 (firm_subscriptions) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Firm-level Stripe subscription metadata. Mirrors the user-level
-- `subscriptions` table but keyed by firm. Stripe customer + sub IDs
-- come from a Stripe webhook handler we'll wire next; for now we
-- have a place to store them.

create table if not exists public.firm_subscriptions (
  firm_id uuid primary key references public.firms(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  status text,             -- 'active' | 'trialing' | 'past_due' | 'canceled' | etc.
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

-- Writes only via service-role / Stripe webhook (no user-side policy).
-- Owners trigger a checkout via a server action that writes through
-- the service-role client; the customer portal updates via webhook.

-- Bring the per-tier limits onto the firms row so we don't have to
-- hardcode them in the app. These can be tweaked per-firm from the
-- super-admin panel later. The migration writes the v1 defaults; the
-- application layer will mirror them when a tier changes.
-- (firms already has client_seats_limit and preparer_seats_limit
-- from the part1 enterprise migration; we just add a "monthly client
-- onboarding" indicator for future quota tracking.)
alter table public.firms
  add column if not exists onboarded_clients_this_month int not null default 0;
