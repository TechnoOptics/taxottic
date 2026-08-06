-- Recovered 20260616010722 (charitable_donations) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.charitable_donations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  tax_year integer not null,
  amount_cents bigint not null check (amount_cents > 0),
  kind text not null default 'cash' check (kind in ('cash', 'noncash')),
  recipient text,
  donated_on date not null default (now() at time zone 'utc')::date,
  created_at timestamptz not null default now()
);

create index if not exists charitable_donations_user_year_idx
  on public.charitable_donations (user_id, tax_year);

alter table public.charitable_donations enable row level security;

create policy "charitable_donations: own select"
  on public.charitable_donations for select
  using (user_id = auth.uid());

create policy "charitable_donations: own insert"
  on public.charitable_donations for insert
  with check (user_id = auth.uid());

create policy "charitable_donations: own update"
  on public.charitable_donations for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "charitable_donations: own delete"
  on public.charitable_donations for delete
  using (user_id = auth.uid());
