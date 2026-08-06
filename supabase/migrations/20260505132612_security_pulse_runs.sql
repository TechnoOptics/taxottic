-- Recovered 20260505132612 (security_pulse_runs) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.security_pulse_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  score smallint not null check (score between 0 and 100),
  status text not null check (status in ('healthy', 'attention', 'critical')),
  results jsonb not null,
  run_by uuid references auth.users(id) on delete set null,
  source text not null default 'manual' check (source in ('manual', 'cron'))
);

create index if not exists security_pulse_runs_run_at_idx
  on public.security_pulse_runs (run_at desc);

create index if not exists security_pulse_runs_status_idx
  on public.security_pulse_runs (status, run_at desc);

alter table public.security_pulse_runs enable row level security;

drop policy if exists "spr: super read" on public.security_pulse_runs;
create policy "spr: super read"
  on public.security_pulse_runs for select
  using (public.is_super_admin());
