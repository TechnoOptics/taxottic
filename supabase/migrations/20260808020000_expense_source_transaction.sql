-- One bank transaction can produce at most one expense. Enforced by the
-- database, not by the caller.
--
-- ***********************************************************************
-- NOT APPLIED. A HUMAN MUST APPLY THIS.
--
-- Timestamped after 20260808010000_move_booked_transaction.sql, the
-- newest migration on origin/main, because a file that sorts earlier is
-- either silently skipped by "supabase db push" or replays out of order
-- on every fresh environment. scripts/check-migration-order.mjs enforces
-- this in CI; it was written after that bug class hit three times in one
-- night.
--
-- Until this is applied, the application code keeps working: the booking
-- helper in lib/csv/book-expense.ts detects that
-- book_bank_transaction_expense does not exist and falls back to a
-- compare-and-swap version of the old two-step path. That fallback
-- narrows the race; only this migration closes it.
--
-- Verify after applying:
--   select column_name from information_schema.columns
--     where table_name = 'monthly_expenses'
--       and column_name = 'source_transaction_id';
--   select indexname from pg_indexes
--     where indexname = 'monthly_expenses_source_transaction_uidx';
--   select proname from pg_proc
--     where proname = 'book_bank_transaction_expense';
--   select count(*) from public.monthly_expenses
--     where source_transaction_id is not null;
--   select count(*) from public.expense_booking_orphans;   -- expect 0
-- ***********************************************************************
--
-- ---------------------------------------------------------------
-- THE INCIDENT
-- ---------------------------------------------------------------
-- 2026-08-06. One company carried 32 phantom monthly_expenses rows, 25
-- in July and 7 in June, totalling $25,061.22. Every one of them was
-- inserted at the same microsecond, 18:40:08.05693+00, and a second run
-- 21 seconds later at 18:40:29 inserted the same expenses again and took
-- ownership of the bank_transactions.applied_expense_id links. The
-- July deduction total was 45% too high. The 32 losing rows were
-- invisible: nothing pointed at them, no import could un-apply them, and
-- the only surface that could see them was the deduction total itself.
--
-- ---------------------------------------------------------------
-- THE MECHANISM
-- ---------------------------------------------------------------
-- Both booking paths, applySelected and runBellaCategorize in
-- app/c/[publicId]/import/actions.ts, did this:
--
--   1. insert into monthly_expenses
--   2. update bank_transactions.applied_expense_id
--
-- Between step 1 and step 2 the transaction still reads as unbooked.
-- Any concurrent run, retry, or double submit passes the "not booked
-- yet" filter and inserts a second expense. applied_expense_id holds one
-- id, so the loser of that race is orphaned but still counted, because
-- every deduction total sums monthly_expenses and none of them join back
-- through the link.
--
-- Checking harder in TypeScript does not fix this. The check and the
-- insert are separate round trips no matter how the check is written, so
-- the window survives every version of the check. The fix has to be a
-- constraint the database refuses to violate, plus one statement that
-- makes the claim and the link inseparable.
--
-- ---------------------------------------------------------------
-- WHAT THIS ADDS
-- ---------------------------------------------------------------
--   1. monthly_expenses.source_transaction_id, the link stated on the
--      expense side, where the uniqueness can be enforced
--   2. a partial UNIQUE index on it, so a second expense for the same
--      transaction cannot be inserted at all
--   3. book_bank_transaction_expense(), which claims and links inside
--      one transaction and reports "already booked" instead of raising
--   4. expense_booking_orphans, a view that names the bug class this
--      incident belongs to: an expense that claims a transaction which
--      no transaction points back at
--
-- Purely additive. No existing row is rewritten except to stamp the
-- new column from links that already exist.
--
-- ---------------------------------------------------------------
-- WHY source_transaction_id AND NOT JUST applied_expense_id
-- ---------------------------------------------------------------
-- bank_transactions.applied_expense_id already records the pairing, but
-- it cannot enforce it. A UNIQUE index on applied_expense_id would stop
-- two transactions sharing one expense, which is not the failure that
-- happened. The failure was two expenses for one transaction, and only a
-- column on monthly_expenses can carry a constraint that forbids that.
--
-- The two columns are kept in sync by book_bank_transaction_expense and
-- audited by expense_booking_orphans. They are deliberately not merged:
-- applied_expense_id is what every read path already uses, and dropping
-- it would touch nine files on a filed-tax surface for no safety gain.
--
-- ---------------------------------------------------------------
-- WHY on delete set null
-- ---------------------------------------------------------------
-- Deleting an import cascades to its bank_transactions. An expense the
-- user has since edited by hand should not vanish because the import it
-- came from was removed, and a cascade here would delete filed
-- deductions as a side effect of tidying up an upload. SET NULL leaves
-- the expense standing as a manual row, which is exactly what it has
-- become. deleteImport still removes the expenses it created, by both
-- id and source_transaction_id, on purpose and in the open.
--
-- ---------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------
--   drop view if exists public.expense_booking_orphans;
--   drop function if exists public.book_bank_transaction_expense(uuid, uuid, int, int, bigint, text, text, text);
--   drop index if exists public.monthly_expenses_source_transaction_uidx;
--   alter table public.monthly_expenses drop column if exists source_transaction_id;
-- Dropping the column loses the provenance of every booked expense. The
-- links in bank_transactions.applied_expense_id survive, so the backfill
-- below can rebuild it.

begin;

-- ---------------------------------------------------------------
-- 1. The column
-- ---------------------------------------------------------------
alter table public.monthly_expenses
  add column if not exists source_transaction_id uuid
    references public.bank_transactions(id) on delete set null;

comment on column public.monthly_expenses.source_transaction_id is
  'The bank_transactions row this expense was booked from, or null for a manually entered expense. UNIQUE where not null: one transaction can never produce two expenses. Null is the normal case for hand-entered rows and for Stripe fee rows, which have no bank transaction behind them.';

-- ---------------------------------------------------------------
-- 2. Backfill from the links that already exist
-- ---------------------------------------------------------------
-- Every currently booked expense is reachable from exactly one
-- transaction, because applied_expense_id is single valued. The
-- subquery is ordered so the result is deterministic if a past bug ever
-- left two transactions pointing at one expense: the earliest link wins,
-- and the verification block below reports the discrepancy.
update public.monthly_expenses e
   set source_transaction_id = (
     select t.id
       from public.bank_transactions t
      where t.applied_expense_id = e.id
      order by t.created_at, t.id
      limit 1
   )
 where e.source_transaction_id is null
   and exists (
     select 1 from public.bank_transactions t where t.applied_expense_id = e.id
   );

-- Verify the backfill before anything relies on it. A silent partial
-- backfill would leave real bookings looking manual, and the unique
-- index would then let exactly the duplicate this migration exists to
-- prevent through.
do $$
declare
  v_linked      bigint;  -- transactions that point at an expense
  v_distinct    bigint;  -- distinct expenses they point at
  v_backfilled  bigint;  -- expenses now carrying a source
begin
  select count(*), count(distinct applied_expense_id)
    into v_linked, v_distinct
    from public.bank_transactions
   where applied_expense_id is not null;

  select count(*) into v_backfilled
    from public.monthly_expenses
   where source_transaction_id is not null;

  raise notice
    'source_transaction_id backfill: % linked transactions, % distinct expenses, % expense rows stamped',
    v_linked, v_distinct, v_backfilled;

  if v_backfilled <> v_distinct then
    raise exception
      'backfill mismatch: % expense rows stamped but % distinct expenses are linked from bank_transactions. Nothing has been committed; investigate before retrying.',
      v_backfilled, v_distinct;
  end if;

  if v_linked <> v_distinct then
    raise warning
      '% transactions point at only % distinct expenses, so some expenses are claimed by more than one transaction. The backfill kept the earliest link for each; the rest appear in expense_booking_orphans as unclaimed transactions.',
      v_linked, v_distinct;
  end if;
end $$;

-- ---------------------------------------------------------------
-- 3. The constraint
-- ---------------------------------------------------------------
-- Partial, because a manually entered expense has no transaction behind
-- it and there are many of them. In postgres every null is distinct in a
-- unique index anyway, so the WHERE clause is about index size and
-- intent rather than correctness.
--
-- Created after the backfill on purpose: if the backfill ever produced
-- two expenses claiming one transaction, this fails and the whole
-- migration rolls back, which is the correct outcome.
create unique index if not exists monthly_expenses_source_transaction_uidx
  on public.monthly_expenses (source_transaction_id)
  where source_transaction_id is not null;

-- ---------------------------------------------------------------
-- 4. The atomic claim
-- ---------------------------------------------------------------
-- Insert and link in one statement pair inside one transaction, so they
-- cannot be separated by a crash, a retry, or a second concurrent run.
--
-- A duplicate attempt returns status 'already_booked' rather than
-- raising. That distinction matters: these calls run in a loop over a
-- batch, and an exception would fail the caller's row (or, on the old
-- bulk path, the whole batch) for what is in fact the desired end state.
-- The row is booked exactly once, which is what the caller wanted.
--
-- AUTHORIZATION. The callers hold the service-role client and have
-- already checked company membership (loadImportForAction). This
-- re-derives the company from the transaction and refuses any actor who
-- is not a member, so a future caller cannot lose the check. EXECUTE is
-- revoked from anon, authenticated and public: postgres grants EXECUTE
-- to PUBLIC by default, which is how three SECURITY DEFINER functions
-- once became internet-facing (20260802041109). The service role
-- bypasses function grants, so the server actions are unaffected.
create or replace function public.book_bank_transaction_expense(
  p_transaction_id uuid,
  p_actor_user_id  uuid,
  p_tax_year       int,
  p_month          int,
  p_amount_cents   bigint,
  p_category_code  text,
  p_recurrence     text,
  p_notes          text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tx        record;
  v_existing  uuid;
  v_new       uuid;
  v_role      text;
begin
  -- Argument guards first. monthly_expenses is a filed-tax surface and
  -- these are all NOT NULL or CHECKed on the table; catching them here
  -- names the problem instead of surfacing a constraint violation.
  if p_category_code is null or length(trim(p_category_code)) = 0 then
    raise exception 'category_required' using errcode = '22023';
  end if;
  if p_month is null or p_month < 1 or p_month > 12 then
    raise exception 'invalid_month' using errcode = '22023';
  end if;
  if p_tax_year is null or p_tax_year < 2000 or p_tax_year > 2100 then
    raise exception 'invalid_tax_year' using errcode = '22023';
  end if;
  -- Zero is not an argument error, it is a row nobody should book, and
  -- planExpenseBooking already refuses it. Reaching here with zero means
  -- a caller skipped the planner.
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  -- FOR UPDATE serializes two runs racing the same transaction. The
  -- second one blocks here, then re-reads the row the first one just
  -- committed and sees applied_expense_id set. This alone would have
  -- prevented the 18:40:08 / 18:40:29 pair; the unique index above is
  -- what makes it true for callers that never take this path.
  select id, company_id, applied_expense_id, applied_income_id,
         applied_category_code
    into v_tx
    from public.bank_transactions
   where id = p_transaction_id
   for update;
  if not found then
    raise exception 'transaction_not_found' using errcode = 'P0002';
  end if;

  select role into v_role
    from public.company_members
   where company_id = v_tx.company_id
     and user_id = p_actor_user_id;
  if v_role is null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- Already booked. A no-op, reported as such.
  if v_tx.applied_expense_id is not null then
    return jsonb_build_object(
      'ok', true,
      'status', 'already_booked',
      'transaction_id', p_transaction_id,
      'expense_id', v_tx.applied_expense_id
    );
  end if;

  -- Booked on the other side of the ledger. Refuse rather than book a
  -- deduction for a row that is already counted as income; moving it is
  -- move_booked_transaction's job and requires a human decision.
  if v_tx.applied_income_id is not null then
    return jsonb_build_object(
      'ok', false,
      'status', 'booked_as_income',
      'transaction_id', p_transaction_id,
      'expense_id', null
    );
  end if;

  -- The orphan case, healed rather than duplicated. An expense already
  -- claims this transaction but nothing points back at it, which is the
  -- exact state the 32 phantom rows were left in. Repoint the link at
  -- the row that already exists; do not insert a second one.
  select id into v_existing
    from public.monthly_expenses
   where source_transaction_id = p_transaction_id
   limit 1;
  if v_existing is not null then
    update public.bank_transactions
       set applied_expense_id = v_existing,
           applied_category_code = coalesce(v_tx.applied_category_code, p_category_code)
     where id = p_transaction_id;
    return jsonb_build_object(
      'ok', true,
      'status', 'already_booked',
      'transaction_id', p_transaction_id,
      'expense_id', v_existing
    );
  end if;

  insert into public.monthly_expenses (
    company_id, user_id, tax_year, month, amount_cents,
    category_code, recurrence, notes, source_transaction_id
  ) values (
    v_tx.company_id,
    -- Who entered the row, which on this path is whoever pressed Apply
    -- or uploaded the file.
    p_actor_user_id,
    p_tax_year, p_month, p_amount_cents,
    p_category_code,
    coalesce(p_recurrence, 'one_off')::public.entry_recurrence,
    p_notes,
    p_transaction_id
  )
  returning id into v_new;

  update public.bank_transactions
     set applied_expense_id = v_new,
         applied_category_code = p_category_code
   where id = p_transaction_id;

  return jsonb_build_object(
    'ok', true,
    'status', 'booked',
    'transaction_id', p_transaction_id,
    'expense_id', v_new
  );

exception
  -- Belt and braces behind the row lock. If a concurrent inserter ever
  -- reaches monthly_expenses without taking the lock, the unique index
  -- rejects it here and the loser reports the winner's row instead of
  -- failing. This is the guarantee that does not depend on any caller
  -- doing anything right.
  when unique_violation then
    select id into v_existing
      from public.monthly_expenses
     where source_transaction_id = p_transaction_id
     limit 1;
    return jsonb_build_object(
      'ok', true,
      'status', 'already_booked',
      'transaction_id', p_transaction_id,
      'expense_id', v_existing
    );
end;
$$;

comment on function public.book_bank_transaction_expense(uuid, uuid, int, int, bigint, text, text, text) is
  'Book one bank_transactions row as a monthly_expenses row and link it, in a single transaction. Returns status booked, already_booked or booked_as_income. A repeated call is a no-op, never a second expense. Service-role only.';

revoke execute on function
  public.book_bank_transaction_expense(uuid, uuid, int, int, bigint, text, text, text)
  from anon, authenticated, public;

-- ---------------------------------------------------------------
-- 5. The orphan audit
-- ---------------------------------------------------------------
-- Names the bug class rather than one instance of it. An expense that
-- claims a transaction which no transaction points back at is either a
-- lost link or a duplicate that lost a race, and both inflate the
-- deduction total while being invisible on every screen.
--
-- Rows with a null source_transaction_id are NOT orphans. Hand-entered
-- expenses and the Stripe fee rows the sync creates have no transaction
-- behind them and are legitimately unlinked; four of them were nearly
-- deleted during the 2026-08-06 cleanup for looking like the phantoms.
--
-- security_invoker so the reader's RLS applies and this cannot become a
-- cross-company read of every expense in the database.
create or replace view public.expense_booking_orphans
with (security_invoker = true) as
  select
    e.id                    as expense_id,
    e.company_id,
    e.tax_year,
    e.month,
    e.amount_cents,
    e.category_code,
    e.source_transaction_id,
    e.created_at
  from public.monthly_expenses e
  where e.source_transaction_id is not null
    and not exists (
      select 1
        from public.bank_transactions t
       where t.applied_expense_id = e.id
    );

comment on view public.expense_booking_orphans is
  'Expenses that claim a bank transaction which does not point back at them. Every row is a bug: a lost link or a duplicate that lost a race. Expected to be empty. Expenses with a null source_transaction_id are manual and never appear here.';

revoke all on public.expense_booking_orphans from anon, public;
grant select on public.expense_booking_orphans to authenticated;

commit;
