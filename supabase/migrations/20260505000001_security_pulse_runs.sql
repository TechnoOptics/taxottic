-- Security Pulse: a record of each security-monitor sweep so the HQ
-- dashboard can show a trendline plus a current snapshot. One row per
-- run; the row's payload column captures every individual monitor's
-- status, detail, and remediation link.
--
-- Scope: super-admin-only. Service-role-only at the RLS layer because
-- the only callers are (a) the manual "Run Pulse Now" action invoked
-- from the HQ dashboard and (b) the daily cron we wire next to keep
-- the trendline fresh.

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

-- Read access via super-admin only. Writes are service-role only and
-- happen from the server action / cron path.
drop policy if exists "spr: super read" on public.security_pulse_runs;
create policy "spr: super read"
  on public.security_pulse_runs for select
  using (public.is_super_admin());
