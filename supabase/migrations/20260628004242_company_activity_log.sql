-- Recovered 20260628004242 (company_activity_log) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.company_activity (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  kind text not null,
  summary text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists company_activity_company_idx
  on public.company_activity (company_id, created_at desc);

alter table public.company_activity enable row level security;

drop policy if exists "company members read activity" on public.company_activity;
create policy "company members read activity"
  on public.company_activity
  for select
  using (
    public.is_company_member(company_id)
    or public.is_super_admin()
  );
