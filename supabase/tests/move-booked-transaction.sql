-- move_booked_transaction: atomicity and authorization tests.
--
-- Proves, as actual calls against a real database rather than an
-- argument about the function body, that:
--
--   1. income -> expense moves the whole thing: the monthly_income row
--      is gone, a monthly_expenses row exists for the same year, month
--      and amount, and bank_transactions points at the new row ONLY
--   2. expense -> income does the reverse, and the round trip lands the
--      row back where it started with the same numbers
--   3. the transaction NEVER points at both an income row and an
--      expense row, and never at neither, at any point that is
--      observable from outside the call
--   4. a failed move writes NOTHING: a to_expense call with no category
--      raises, and the income row plus its pointer survive untouched.
--      This is the whole reason the move is one function instead of a
--      sequence of client awaits, so it gets its own assertion
--   5. a member who is neither a manager nor the owner of the booked
--      row is refused, and again nothing is written
--   6. the owner of the booked row may move it even without being a
--      manager (control -- without this, 5 would pass on a function
--      that refuses everybody)
--   7. a manager may move a row somebody else booked (the other control)
--   8. a stranger from another company is refused
--   9. moving a row that is not booked at all is refused
--
-- Run with:
--   psql $DATABASE_URL -f supabase/tests/move-booked-transaction.sql
--
-- Seeds scratch companies and users, asserts, then rolls back. No
-- production data is touched.
--
-- Assumes 20260808010000_move_booked_transaction.sql has been applied.
-- Every assertion errors with "function ... does not exist" without it.

begin;

do $$
declare
  v_boss   uuid := gen_random_uuid();  -- manager
  v_grace  uuid := gen_random_uuid();  -- member, books her own row
  v_marwan uuid := gen_random_uuid();  -- member, books nothing
  v_rival  uuid := gen_random_uuid();  -- another company entirely
  v_co_a   uuid := gen_random_uuid();
  v_co_b   uuid := gen_random_uuid();
  v_imp    uuid;
  v_tx     uuid;
  v_tx2    uuid;
  v_inc    uuid;
  v_exp    uuid;
  v_new    uuid;
  v_n      int;
  v_cents  bigint;
  v_month  int;
  v_note   text;
  v_res    jsonb;
begin
  -- ------------------------------------------------------------
  -- Seed
  -- ------------------------------------------------------------
  insert into auth.users
    (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_boss,   'move-boss@example.invalid',   now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_grace,  'move-grace@example.invalid',  now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_marwan, 'move-marwan@example.invalid', now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_rival,  'move-rival@example.invalid',  now(), '{}', '{}', 'authenticated', 'authenticated');

  insert into public.profiles (id, email)
  values
    (v_boss,   'move-boss@example.invalid'),
    (v_grace,  'move-grace@example.invalid'),
    (v_marwan, 'move-marwan@example.invalid'),
    (v_rival,  'move-rival@example.invalid')
  on conflict (id) do nothing;

  insert into public.companies (id, name, public_id, created_by)
  values
    (v_co_a, 'Move Co A', 'co_' || substring(replace(v_co_a::text, '-', ''), 1, 10), v_boss),
    (v_co_b, 'Move Co B', 'co_' || substring(replace(v_co_b::text, '-', ''), 1, 10), v_rival);

  insert into public.company_members (company_id, user_id, role)
  values
    (v_co_a, v_boss,   'manager'),
    (v_co_a, v_grace,  'member'),
    (v_co_a, v_marwan, 'member'),
    (v_co_b, v_rival,  'manager')
  on conflict do nothing;

  insert into public.bank_imports (company_id, user_id, filename, row_count, status, account_type)
  values (v_co_a, v_grace, 'move-test.csv', 2, 'reviewing', 'business_checking')
  returning id into v_imp;

  -- The shape of the 2026-08-06 incident: a $4,000 deposit-looking row
  -- booked as income by the import.
  insert into public.bank_transactions (import_id, company_id, posted_at, description, amount_cents)
  values (v_imp, v_co_a, date_trunc('month', current_date)::date, 'IN *OJALA-BARBOUR', 400000)
  returning id into v_tx;

  insert into public.monthly_income
    (company_id, user_id, tax_year, month, amount_cents, source, recurrence, notes)
  values
    (v_co_a, v_grace, extract(year from current_date)::int,
     extract(month from current_date)::int, 400000, 'sales', 'one_off',
     'IN *OJALA-BARBOUR')
  returning id into v_inc;

  update public.bank_transactions
     set applied_income_id = v_inc
   where id = v_tx;

  -- A second, unbooked row for assertion 9.
  insert into public.bank_transactions (import_id, company_id, posted_at, description, amount_cents)
  values (v_imp, v_co_a, current_date, 'UNBOOKED ROW', -1234)
  returning id into v_tx2;

  -- ------------------------------------------------------------
  -- 4. A move with no category writes NOTHING.
  --    Run FIRST, so the assertions below are working on a row that
  --    has already survived a failed attempt.
  -- ------------------------------------------------------------
  begin
    perform public.move_booked_transaction(
      v_tx, v_grace, 'to_expense', null, null, 'should not happen');
    raise exception 'FAIL: a to_expense move with no category was accepted';
  exception
    when sqlstate '22023' then
      null;  -- category_required, as intended
  end;

  select count(*) into v_n from public.monthly_income where id = v_inc;
  if v_n <> 1 then
    raise exception 'FAIL: the failed move destroyed the income row';
  end if;
  select count(*) into v_n from public.bank_transactions
   where id = v_tx and applied_income_id = v_inc and applied_expense_id is null;
  if v_n <> 1 then
    raise exception 'FAIL: the failed move moved the transaction pointer anyway';
  end if;
  select count(*) into v_n from public.monthly_expenses where company_id = v_co_a;
  if v_n <> 0 then
    raise exception 'FAIL: the failed move left % orphan expense rows', v_n;
  end if;

  -- ------------------------------------------------------------
  -- 5. A member who neither booked the row nor manages is refused,
  --    and again nothing is written.
  -- ------------------------------------------------------------
  begin
    perform public.move_booked_transaction(
      v_tx, v_marwan, 'to_expense', 'legal_pro', null, 'not his to move');
    raise exception 'FAIL: a non-manager, non-owner member moved a booked row';
  exception
    when sqlstate '42501' then
      null;
  end;
  select count(*) into v_n from public.monthly_expenses where company_id = v_co_a;
  if v_n <> 0 then
    raise exception 'FAIL: the refused move still inserted an expense row';
  end if;

  -- ------------------------------------------------------------
  -- 8. A stranger from another company is refused.
  -- ------------------------------------------------------------
  begin
    perform public.move_booked_transaction(
      v_tx, v_rival, 'to_expense', 'legal_pro', null, 'not his company');
    raise exception 'FAIL: a member of another company moved this row';
  exception
    when sqlstate '42501' then
      null;
  end;

  -- ------------------------------------------------------------
  -- 9. A row that is not booked at all cannot be moved.
  -- ------------------------------------------------------------
  begin
    perform public.move_booked_transaction(
      v_tx2, v_boss, 'to_expense', 'legal_pro', null, 'nothing to move');
    raise exception 'FAIL: an unbooked row was moved';
  exception
    when sqlstate '22023' then
      null;
  end;

  -- ------------------------------------------------------------
  -- 1 + 3 + 6. The owner moves her own row, income -> expense.
  -- ------------------------------------------------------------
  v_res := public.move_booked_transaction(
    v_tx, v_grace, 'to_expense', 'legal_pro', null,
    'Moved from income to expense. Reason: this was a legal fee.');
  if not (v_res ->> 'ok')::boolean then
    raise exception 'FAIL: the move reported not ok: %', v_res;
  end if;
  v_new := (v_res ->> 'new_row_id')::uuid;

  select count(*) into v_n from public.monthly_income where id = v_inc;
  if v_n <> 0 then
    raise exception 'FAIL: the income row survived the move';
  end if;

  select amount_cents, month, manager_note into v_cents, v_month, v_note
    from public.monthly_expenses where id = v_new;
  if v_cents <> 400000 then
    raise exception 'FAIL: the moved amount changed: %', v_cents;
  end if;
  if v_month <> extract(month from current_date)::int then
    raise exception 'FAIL: the moved month changed: %', v_month;
  end if;
  if v_note is null or v_note = '' then
    raise exception 'FAIL: the move left no audit note on the expense row';
  end if;

  -- The invariant. Never both, never neither.
  select count(*) into v_n from public.bank_transactions
   where id = v_tx
     and applied_expense_id = v_new
     and applied_income_id is null;
  if v_n <> 1 then
    raise exception 'FAIL: after the move the transaction does not point at the expense alone';
  end if;

  -- ------------------------------------------------------------
  -- 2 + 7. A manager moves somebody else's row back, expense -> income.
  --        The round trip must land on the same numbers.
  -- ------------------------------------------------------------
  v_exp := v_new;
  v_res := public.move_booked_transaction(
    v_tx, v_boss, 'to_income', null, 'services',
    'Moved back: it was a client payment after all.');
  v_new := (v_res ->> 'new_row_id')::uuid;

  select count(*) into v_n from public.monthly_expenses where id = v_exp;
  if v_n <> 0 then
    raise exception 'FAIL: the expense row survived the move back';
  end if;

  select amount_cents, month, manager_note into v_cents, v_month, v_note
    from public.monthly_income where id = v_new;
  if v_cents <> 400000 then
    raise exception 'FAIL: the round trip changed the amount: %', v_cents;
  end if;
  if v_month <> extract(month from current_date)::int then
    raise exception 'FAIL: the round trip changed the month: %', v_month;
  end if;
  if v_note is null or v_note = '' then
    raise exception 'FAIL: the move back left no audit note on the income row';
  end if;

  select count(*) into v_n from public.bank_transactions
   where id = v_tx
     and applied_income_id = v_new
     and applied_expense_id is null
     -- The expense's Schedule C line means nothing on an income row.
     and applied_category_code is null;
  if v_n <> 1 then
    raise exception 'FAIL: after the move back the transaction does not point at the income alone';
  end if;

  -- 3, stated once more over the whole table: no transaction in this
  -- company points at both, or at an id that no longer exists.
  select count(*) into v_n from public.bank_transactions t
   where t.company_id = v_co_a
     and t.applied_expense_id is not null
     and t.applied_income_id is not null;
  if v_n <> 0 then
    raise exception 'FAIL: % transactions point at BOTH an income and an expense row', v_n;
  end if;

  select count(*) into v_n from public.bank_transactions t
   where t.company_id = v_co_a
     and t.applied_expense_id is not null
     and not exists (select 1 from public.monthly_expenses e where e.id = t.applied_expense_id);
  if v_n <> 0 then
    raise exception 'FAIL: % transactions point at a deleted expense row', v_n;
  end if;

  select count(*) into v_n from public.bank_transactions t
   where t.company_id = v_co_a
     and t.applied_income_id is not null
     and not exists (select 1 from public.monthly_income i where i.id = t.applied_income_id);
  if v_n <> 0 then
    raise exception 'FAIL: % transactions point at a deleted income row', v_n;
  end if;

  raise notice 'PASS: move_booked_transaction, all 9 assertions';
end $$;

rollback;
