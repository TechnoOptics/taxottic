-- Move one booked bank transaction between income and expense, atomically.
--
-- ***********************************************************************
-- NOT APPLIED. A HUMAN MUST APPLY THIS.
--
-- Three migrations tonight were silently skipped because their
-- timestamps predated the applied high-water mark: `db push` reported
-- success and did nothing. This file is timestamped after 20260808000300
-- for that reason, and it has deliberately NOT been pushed. Until it is,
-- moveBookedTransaction in app/c/[publicId]/import/actions.ts returns
-- "not_available" and the UI control says so rather than half-writing
-- anything.
--
-- Verify after applying:
--   select proname from pg_proc where proname = 'move_booked_transaction';
--   select column_name from information_schema.columns
--     where table_name = 'monthly_income' and column_name = 'manager_note';
-- ***********************************************************************
--
-- ---------------------------------------------------------------
-- WHY
-- ---------------------------------------------------------------
-- Requested by the owner, verbatim: "PLEASE ALSO HAVE A FEATURE WHERE
-- THE USER CAN MOVE AN INCOME TO AN EXPENSE AND VICE VERSA".
--
-- It is also the only remedy when something is booked wrongly. On
-- 2026-08-06 a $4,000 row the owner had coded legal_pro was booked as
-- $4,000 of INCOME by the import's income branch (fixed separately, see
-- lib/csv/income-booking.ts). The correction had to be done by hand, in
-- the SQL editor, against production, because the app offered no way
-- back short of deleting the import and re-uploading it.
--
-- ---------------------------------------------------------------
-- WHY A FUNCTION AND NOT THREE AWAITS
-- ---------------------------------------------------------------
-- A move is four writes that must all land or none:
--
--   income -> expense : delete monthly_income, insert monthly_expenses,
--                       set bank_transactions.applied_expense_id,
--                       null bank_transactions.applied_income_id
--   expense -> income : the reverse
--
-- The supabase-js client has no transaction. A sequence of separate
-- awaits can half-fail, and every half-failure here is a corrupt tax
-- record: a transaction pointing at BOTH an income row and an expense
-- row is counted twice on the Schedule C, and one pointing at NEITHER
-- silently drops a line off the return. Neither is detectable by
-- looking at the app.
--
-- A plpgsql function body is a single transaction. Any raise below
-- rolls the whole move back, and the row stays exactly where it was.
-- The insert-then-repoint-then-delete order is deliberate: the new row
-- exists and is pointed at before the old one goes, so the failure
-- modes are "nothing happened" or "the move completed", never an
-- orphan on a filed-deduction surface.
--
-- ---------------------------------------------------------------
-- AUTHORIZATION
-- ---------------------------------------------------------------
-- The caller (a server action holding the service-role client) has
-- already resolved company_id FROM THE ROW and checked that the actor is
-- a manager of that company or the owner of the booked row. This
-- function re-derives the company from the transaction anyway and
-- refuses any actor who is neither, so the check cannot be lost by a
-- future caller that forgets it.
--
-- EXECUTE is revoked from anon, authenticated and public. Postgres
-- grants EXECUTE to PUBLIC by default, which is how three SECURITY
-- DEFINER functions came to be internet-facing (see
-- 20260802041109_revoke_anon_execute_on_internal_rpcs.sql). The service
-- role bypasses function grants, so the server action is unaffected.
--
-- ---------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------
--   drop function if exists public.move_booked_transaction(uuid, uuid, text, text, text, text);
--   alter table public.monthly_income drop column if exists manager_note;
-- Dropping the column loses any move notes written into it. Read them
-- out first if the moves matter:
--   select id, tax_year, month, amount_cents, manager_note
--     from public.monthly_income where manager_note is not null;

begin;

-- ---------------------------------------------------------------
-- monthly_income.manager_note
-- ---------------------------------------------------------------
-- monthly_expenses has carried manager_note since 20260702191929 and it
-- is already rendered on the expenses page, so the audit sentence a move
-- writes is visible to a CPA with no new UI. monthly_income had no
-- equivalent, which would have made the audit trail one-directional:
-- expense -> income would move a line and leave no note anywhere a human
-- reads. Same name, same type, same purpose, so the note survives a
-- round trip in either direction.
--
-- Additive and nullable. Nothing reads it yet besides the move.
alter table public.monthly_income
  add column if not exists manager_note text;

comment on column public.monthly_income.manager_note is
  'Free-text reviewer note. Also carries the audit sentence written by move_booked_transaction when a line is moved here from monthly_expenses.';

-- ---------------------------------------------------------------
-- The move
-- ---------------------------------------------------------------
create or replace function public.move_booked_transaction(
  p_transaction_id uuid,
  p_actor_user_id  uuid,
  p_direction      text,
  p_category_code  text,
  p_income_source  text,
  p_note           text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_tx          record;
  v_src         record;
  v_new_id      uuid;
  v_role        text;
  v_is_manager  boolean;
begin
  if p_direction not in ('to_income', 'to_expense') then
    raise exception 'invalid_direction' using errcode = '22023';
  end if;

  -- FOR UPDATE: two people pressing Move on the same row, or a Move
  -- racing an Apply, must serialize. Without the lock both could read
  -- applied_expense_id, both insert, and the loser's row would be
  -- orphaned on the deduction surface with nothing pointing at it.
  select id, company_id, import_id, description, posted_at, amount_cents,
         applied_expense_id, applied_income_id, applied_category_code
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
  v_is_manager := (v_role = 'manager');

  if p_direction = 'to_expense' then
    if v_tx.applied_income_id is null then
      raise exception 'not_booked_as_income' using errcode = '22023';
    end if;
    -- A category is what makes a line a deduction. Refuse the move
    -- rather than invent one: monthly_expenses.category_code is NOT NULL
    -- and references deduction_categories, so a wrong guess here is a
    -- wrong Schedule C line, not a null.
    if p_category_code is null or length(trim(p_category_code)) = 0 then
      raise exception 'category_required' using errcode = '22023';
    end if;

    select * into v_src
      from public.monthly_income
     where id = v_tx.applied_income_id
       and company_id = v_tx.company_id;
    if not found then
      raise exception 'booked_row_not_found' using errcode = 'P0002';
    end if;
    if not v_is_manager and v_src.user_id <> p_actor_user_id then
      raise exception 'not_authorized' using errcode = '42501';
    end if;

    insert into public.monthly_expenses (
      company_id, user_id, tax_year, month, amount_cents,
      category_code, recurrence, notes, manager_note
    ) values (
      v_src.company_id,
      -- user_id records who ENTERED the row, which after a move is the
      -- person who moved it, not whoever the import happened to run as.
      p_actor_user_id,
      v_src.tax_year, v_src.month, v_src.amount_cents,
      p_category_code, v_src.recurrence, v_src.notes, p_note
    )
    returning id into v_new_id;

    update public.bank_transactions
       set applied_expense_id = v_new_id,
           applied_income_id = null,
           applied_category_code = p_category_code
     where id = p_transaction_id;

    delete from public.monthly_income where id = v_src.id;

  else
    if v_tx.applied_expense_id is null then
      raise exception 'not_booked_as_expense' using errcode = '22023';
    end if;
    if p_income_source is null or length(trim(p_income_source)) = 0 then
      raise exception 'source_required' using errcode = '22023';
    end if;

    select * into v_src
      from public.monthly_expenses
     where id = v_tx.applied_expense_id
       and company_id = v_tx.company_id;
    if not found then
      raise exception 'booked_row_not_found' using errcode = 'P0002';
    end if;
    if not v_is_manager and v_src.user_id <> p_actor_user_id then
      raise exception 'not_authorized' using errcode = '42501';
    end if;

    insert into public.monthly_income (
      company_id, user_id, tax_year, month, amount_cents,
      source, recurrence, notes, manager_note
    ) values (
      v_src.company_id,
      p_actor_user_id,
      v_src.tax_year, v_src.month, v_src.amount_cents,
      p_income_source::public.income_source, v_src.recurrence,
      v_src.notes, p_note
    )
    returning id into v_new_id;

    update public.bank_transactions
       set applied_income_id = v_new_id,
           applied_expense_id = null,
           -- The category was the expense's Schedule C line. It means
           -- nothing on an income row, and leaving it would make the row
           -- look categorized on the review screen while pointing at
           -- monthly_income.
           applied_category_code = null
     where id = p_transaction_id;

    delete from public.monthly_expenses where id = v_src.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'direction', p_direction,
    'company_id', v_tx.company_id,
    'new_row_id', v_new_id,
    'removed_row_id', v_src.id,
    'tax_year', v_src.tax_year,
    'month', v_src.month,
    'amount_cents', v_src.amount_cents
  );
end;
$$;

comment on function public.move_booked_transaction(uuid, uuid, text, text, text, text) is
  'Move one booked bank_transactions row between monthly_income and monthly_expenses in a single transaction. Inserts the destination, repoints the transaction, then deletes the source, so the row never points at both or neither. Service-role only.';

revoke execute on function
  public.move_booked_transaction(uuid, uuid, text, text, text, text)
  from anon, authenticated, public;

commit;
