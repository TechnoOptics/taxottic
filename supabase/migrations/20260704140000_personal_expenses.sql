-- Item 14: personal expense tracking for individual (W-2) filers.
--
-- A user-owned ledger of deductible personal items (charitable, medical,
-- mortgage interest, SALT, student loan interest, education). Each row's
-- category maps to a personal forecast input (see
-- lib/tax/personal-expense-categories.ts), so tracked totals flow into the
-- individual forecast. Strictly individual-side: business (Schedule C)
-- expenses stay on the company side (monthly_expenses), keeping the
-- individual/business split clean (items 15-16).

create table if not exists public.personal_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  tax_year int not null,
  category text not null check (
    category in (
      'charitable',
      'medical',
      'mortgage_interest',
      'salt',
      'student_loan_interest',
      'education'
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

-- Owner-only: a personal expense is private to the filer who logged it.
-- Super-admins can read (support / audit) but not write, mirroring the
-- read pattern used elsewhere.
drop policy if exists personal_expenses_select on public.personal_expenses;
create policy personal_expenses_select on public.personal_expenses
  for select
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists personal_expenses_insert on public.personal_expenses;
create policy personal_expenses_insert on public.personal_expenses
  for insert
  with check (user_id = auth.uid());

drop policy if exists personal_expenses_update on public.personal_expenses;
create policy personal_expenses_update on public.personal_expenses
  for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists personal_expenses_delete on public.personal_expenses;
create policy personal_expenses_delete on public.personal_expenses
  for delete
  using (user_id = auth.uid());
