-- Recovered 20260428151714 (phase4_bank_imports) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

do $$ begin
  create type public.import_status as enum ('uploaded', 'reviewing', 'applied', 'archived');
exception when duplicate_object then null;
end $$;

create table if not exists public.bank_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  filename text not null,
  status public.import_status not null default 'uploaded',
  row_count int not null default 0,
  applied_count int not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bank_imports_company_idx on public.bank_imports (company_id, created_at desc);

drop trigger if exists bank_imports_touch on public.bank_imports;
create trigger bank_imports_touch before update on public.bank_imports
  for each row execute function public.touch_updated_at();

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.bank_imports(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  posted_at date,
  description text not null,
  amount_cents bigint not null,             -- negative = withdrawal/expense, positive = deposit/income
  raw_category text,                        -- bank-supplied label, if any
  suggested_category_code text references public.deduction_categories(code) on delete set null,
  applied_category_code text references public.deduction_categories(code) on delete set null,
  applied_expense_id uuid references public.monthly_expenses(id) on delete set null,
  applied_income_id uuid references public.monthly_income(id) on delete set null,
  ignored boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists bank_transactions_import_idx on public.bank_transactions (import_id);
create index if not exists bank_transactions_company_idx on public.bank_transactions (company_id, posted_at);

alter table public.bank_imports enable row level security;
alter table public.bank_transactions enable row level security;

drop policy if exists "imports: member read" on public.bank_imports;
create policy "imports: member read"
  on public.bank_imports for select
  using (public.is_company_member(company_id) or public.is_super_admin());

drop policy if exists "imports: member insert" on public.bank_imports;
create policy "imports: member insert"
  on public.bank_imports for insert
  with check (public.is_company_member(company_id) and user_id = auth.uid());

drop policy if exists "imports: member update" on public.bank_imports;
create policy "imports: member update"
  on public.bank_imports for update
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists "imports: member delete" on public.bank_imports;
create policy "imports: member delete"
  on public.bank_imports for delete
  using (public.is_company_member(company_id));

drop policy if exists "transactions: member read" on public.bank_transactions;
create policy "transactions: member read"
  on public.bank_transactions for select
  using (public.is_company_member(company_id) or public.is_super_admin());

drop policy if exists "transactions: member write" on public.bank_transactions;
create policy "transactions: member write"
  on public.bank_transactions for insert
  with check (public.is_company_member(company_id));

drop policy if exists "transactions: member update" on public.bank_transactions;
create policy "transactions: member update"
  on public.bank_transactions for update
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists "transactions: member delete" on public.bank_transactions;
create policy "transactions: member delete"
  on public.bank_transactions for delete
  using (public.is_company_member(company_id));
