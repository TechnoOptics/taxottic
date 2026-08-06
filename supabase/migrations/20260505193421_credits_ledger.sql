-- Recovered 20260505193421 (credits_ledger) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.credits_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  delta_credits int not null,
  reason text not null,
  ref_id text,
  created_at timestamptz not null default now()
);

create index if not exists credits_ledger_user_created_idx
  on public.credits_ledger (user_id, created_at desc);
create index if not exists credits_ledger_user_reason_idx
  on public.credits_ledger (user_id, reason);

alter table public.credits_ledger enable row level security;

drop policy if exists "credits_ledger: own read" on public.credits_ledger;
create policy "credits_ledger: own read"
  on public.credits_ledger for select
  using (user_id = auth.uid() or public.is_super_admin());

alter table public.subscriptions
  add column if not exists topups_this_period_credits int not null default 0;
alter table public.subscriptions
  add column if not exists auto_topup_pack text
    check (auto_topup_pack in ('boost', 'stack', 'bundle', 'power'));
alter table public.subscriptions
  add column if not exists auto_topup_threshold_credits int;
alter table public.subscriptions
  add column if not exists last_credit_grant_at timestamptz;

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
