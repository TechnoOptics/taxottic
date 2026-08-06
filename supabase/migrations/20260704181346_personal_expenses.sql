-- Recovered 20260704181346 (personal_expenses) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.personal_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tax_year int not null,
  category text not null check (
    category in (
      'charitable','medical','mortgage_interest','salt','student_loan_interest','education'
    )
  ),
  amount_cents bigint not null check (amount_cents > 0),
  incurred_on date not null,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists personal_expenses_user_year_idx
  on public.personal_expenses (user_id, tax_year);

alter table public.personal_expenses enable row level security;

drop policy if exists personal_expenses_select on public.personal_expenses;
create policy personal_expenses_select on public.personal_expenses
  for select using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists personal_expenses_insert on public.personal_expenses;
create policy personal_expenses_insert on public.personal_expenses
  for insert with check (user_id = auth.uid());

drop policy if exists personal_expenses_update on public.personal_expenses;
create policy personal_expenses_update on public.personal_expenses
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists personal_expenses_delete on public.personal_expenses;
create policy personal_expenses_delete on public.personal_expenses
  for delete using (user_id = auth.uid());
