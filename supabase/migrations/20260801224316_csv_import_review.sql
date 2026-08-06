-- Recovered 20260801224316 (csv_import_review) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.bank_imports
  add column if not exists content_sha256 text;

alter table public.bank_imports
  add column if not exists period_start date;
alter table public.bank_imports
  add column if not exists period_end date;

alter table public.bank_imports
  add column if not exists batch_id uuid;

create index if not exists bank_imports_content_hash_idx
  on public.bank_imports (company_id, content_sha256)
  where content_sha256 is not null;

create index if not exists bank_imports_batch_idx
  on public.bank_imports (batch_id, created_at)
  where batch_id is not null;

create table if not exists public.bank_import_duplicates (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null
    references public.bank_imports(id) on delete cascade,
  company_id uuid not null
    references public.companies(id) on delete cascade,
  posted_at date,
  description text not null,
  amount_cents bigint not null,
  fingerprint text not null,
  kind text not null check (kind in ('within_file', 'already_booked')),
  existing_transaction_id uuid
    references public.bank_transactions(id) on delete set null,
  existing_import_id uuid
    references public.bank_imports(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists bank_import_duplicates_import_idx
  on public.bank_import_duplicates (import_id);

create index if not exists bank_import_duplicates_company_idx
  on public.bank_import_duplicates (company_id, created_at desc);

alter table public.bank_import_duplicates enable row level security;

drop policy if exists bank_import_duplicates_select on public.bank_import_duplicates;
create policy bank_import_duplicates_select
  on public.bank_import_duplicates for select
  using (public.is_company_member(company_id) or public.is_super_admin());

drop policy if exists bank_import_duplicates_insert on public.bank_import_duplicates;
create policy bank_import_duplicates_insert
  on public.bank_import_duplicates for insert
  with check (public.is_company_member(company_id));

drop policy if exists bank_import_duplicates_update on public.bank_import_duplicates;
create policy bank_import_duplicates_update
  on public.bank_import_duplicates for update
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists bank_import_duplicates_delete on public.bank_import_duplicates;
create policy bank_import_duplicates_delete
  on public.bank_import_duplicates for delete
  using (public.is_company_member(company_id));

comment on table public.bank_import_duplicates is
  'Rows a CSV import held back as duplicates. Shown to the user on the import review screen so a suppressed charge is never invisible.';
