-- CSV import review: content-based duplicate detection, statement period,
-- upload batches, and a visible record of every row held back as a duplicate.
--
-- Purely additive: four nullable columns, two partial indexes, one new table.
-- Nothing is altered, dropped, updated or deleted.
--
-- Note for future readers: public.bank_imports and public.bank_transactions
-- have no `create table` migration anywhere in this repo. They were created
-- directly against the database before migrations were in use, so this file
-- ALTERs a table the repo has never declared. That is why every statement is
-- `if not exists` guarded.

-- ---------------------------------------------------------------------------
-- bank_imports: content identity, statement period, upload batch
-- ---------------------------------------------------------------------------

-- SHA-256 of the file's NORMALIZED content (see lib/csv/content-hash.ts).
-- Filenames cannot answer "have I already imported this?" because the same
-- statement re-downloaded is routinely saved as "activity (2).csv". Content
-- can. Nullable because every import that predates this column has no hash.
alter table public.bank_imports
  add column if not exists content_sha256 text;

-- The period the rows actually cover, from min/max posted_at. The review
-- screen is titled with this rather than the filename: a user reviewing four
-- statements in a row needs to know which month they are looking at, and
-- "activity (2).csv" does not tell them. Nullable because a file whose dates
-- do not parse genuinely has no period, and inventing one would be a lie.
alter table public.bank_imports
  add column if not exists period_start date;
alter table public.bank_imports
  add column if not exists period_end date;

-- Groups the imports created by one multi-file upload, so the review screen
-- can say "file 2 of 4" and offer the next one. Generated client-side by the
-- dropzone. Nullable: single-file uploads and every historical import have none.
alter table public.bank_imports
  add column if not exists batch_id uuid;

-- Duplicate lookup is always scoped to one company.
create index if not exists bank_imports_content_hash_idx
  on public.bank_imports (company_id, content_sha256)
  where content_sha256 is not null;

create index if not exists bank_imports_batch_idx
  on public.bank_imports (batch_id, created_at)
  where batch_id is not null;

-- ---------------------------------------------------------------------------
-- bank_import_duplicates: what we held back, and why
-- ---------------------------------------------------------------------------
--
-- The ingest path already skipped duplicate rows, but it skipped them
-- silently: they never reached bank_transactions and nothing recorded that
-- they had existed. A user whose statement legitimately contained two
-- identical $40 charges lost one of them with no trace. This table is the
-- trace. Rows here are shown on the review screen, never counted as expenses.

create table if not exists public.bank_import_duplicates (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null
    references public.bank_imports(id) on delete cascade,
  company_id uuid not null
    references public.companies(id) on delete cascade,

  -- A verbatim copy of the row we did not insert, so it can be displayed
  -- (and re-imported by hand) without re-reading the original file.
  posted_at date,
  description text not null,
  amount_cents bigint not null,

  -- chargeFingerprint(posted_at, amount_cents, description). Stored so the
  -- UI can group a duplicate with the transaction it repeats.
  fingerprint text not null,

  -- 'within_file'   the same file listed this charge more than once
  -- 'already_booked' an earlier import already holds this charge
  kind text not null check (kind in ('within_file', 'already_booked')),

  -- Where the surviving copy lives, when we know. SET NULL rather than
  -- CASCADE: if the original transaction is later deleted, the record that a
  -- duplicate was held back is still true and still worth showing.
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

-- RLS mirrors bank_transactions exactly: company members read and write their
-- own company's rows, super admins can read. Writes in the import actions go
-- through the service-role client, so this is a backstop rather than the
-- enforcement path, same as the sibling tables.
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
