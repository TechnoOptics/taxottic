-- Consumer-side activity log: "who changed what, when" for a company's own
-- books. Firms already had firm_activity_log; business owners had no audit
-- trail (the audit flagged this — e.g. no record of who deleted a
-- transaction). This is the company-scoped equivalent.
--
-- Append-only by design: members can READ their company's activity; writes
-- happen only through the service role from server actions (which run their
-- own auth checks first). RLS denies INSERT/UPDATE/DELETE to everyone else.

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
