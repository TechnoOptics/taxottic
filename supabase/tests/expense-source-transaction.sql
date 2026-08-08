-- One transaction, one expense. Proved against a real database.
--
-- The 2026-08-06 incident was 32 monthly_expenses rows for one company,
-- 25 in July and 7 in June, worth $25,061.22, every one inserted at
-- 18:40:08.05693+00 and every one duplicated by a second run 21 seconds
-- later that took the bank_transactions.applied_expense_id links and
-- left the originals orphaned. July's deductions were 45% too high.
--
-- These assertions are the ones that would have failed before the fix:
--
--   1. a direct second insert naming the same source_transaction_id is
--      REFUSED by the database, with no cooperation from any caller
--   2. an expense with a null source_transaction_id is still allowed,
--      and so is a second one, and a third. This is the manually
--      entered row and the Stripe stripe_fee row: four of those were
--      orphaned-looking but real, and were nearly deleted during the
--      cleanup. If this assertion ever fails, hand-entered deductions
--      have stopped working
--   3. book_bank_transaction_expense books once and links once
--   4. calling it again is a no-op that reports already_booked, and
--      does NOT raise, because these calls run in a loop over a batch
--      and an exception would fail a row that is in the exact state the
--      caller wanted
--   5. after the second call there is still exactly ONE expense, and
--      the link still points at it. This is the incident, restated as
--      an assertion
--   6. the orphan case heals: an expense claiming a transaction that
--      does not point back gets the link repointed at it, not a second
--      expense inserted
--   7. expense_booking_orphans is empty afterwards, and does name a
--      real orphan when one is manufactured
--   8. a stranger from another company cannot book the transaction
--   9. a transaction already booked as income is refused rather than
--      double counted
--
-- Run with:
--   psql $DATABASE_URL -f supabase/tests/expense-source-transaction.sql
--
-- Seeds scratch companies and users, asserts, then rolls back. No
-- production data is touched.
--
-- Assumes 20260808020000_expense_source_transaction.sql has been
-- applied. Without it every assertion errors on the missing column or
-- the missing function.

begin;

do $$
declare
  v_boss    uuid := gen_random_uuid();  -- manager of company A
  v_grace   uuid := gen_random_uuid();  -- member of company A
  v_rival   uuid := gen_random_uuid();  -- another company entirely
  v_co_a    uuid := gen_random_uuid();
  v_co_b    uuid := gen_random_uuid();
  v_imp     uuid;
  v_tx      uuid;
  v_tx2     uuid;
  v_tx_inc  uuid;
  v_exp     uuid;
  v_exp2    uuid;
  v_first   uuid;
  v_second  uuid;
  v_n       int;
  v_cents   bigint;
  v_res     jsonb;
  v_year    int := extract(year from current_date)::int;
  v_month   int := extract(month from current_date)::int;
begin
  -- ------------------------------------------------------------
  -- Seed
  -- ------------------------------------------------------------
  insert into auth.users
    (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_boss,  'book-boss@example.invalid',  now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_grace, 'book-grace@example.invalid', now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_rival, 'book-rival@example.invalid', now(), '{}', '{}', 'authenticated', 'authenticated');

  insert into public.profiles (id, email)
  values
    (v_boss,  'book-boss@example.invalid'),
    (v_grace, 'book-grace@example.invalid'),
    (v_rival, 'book-rival@example.invalid')
  on conflict (id) do nothing;

  insert into public.companies (id, name, public_id, created_by)
  values
    (v_co_a, 'Book Co A', 'co_' || substring(replace(v_co_a::text, '-', ''), 1, 10), v_boss),
    (v_co_b, 'Book Co B', 'co_' || substring(replace(v_co_b::text, '-', ''), 1, 10), v_rival);

  insert into public.company_members (company_id, user_id, role)
  values
    (v_co_a, v_boss,  'manager'),
    (v_co_a, v_grace, 'member'),
    (v_co_b, v_rival, 'manager')
  on conflict do nothing;

  insert into public.bank_imports (company_id, user_id, filename, row_count, status, account_type)
  values (v_co_a, v_grace, 'double-booking.csv', 3, 'reviewing', 'business_checking')
  returning id into v_imp;

  -- The shape of the incident: an ordinary charge on a checking import.
  insert into public.bank_transactions (import_id, company_id, posted_at, description, amount_cents)
  values (v_imp, v_co_a, date_trunc('month', current_date)::date, 'AMZN MKTP US*RT4G91', -20647)
  returning id into v_tx;

  insert into public.bank_transactions (import_id, company_id, posted_at, description, amount_cents)
  values (v_imp, v_co_a, date_trunc('month', current_date)::date, 'STAPLES 00109382', -4065)
  returning id into v_tx2;

  insert into public.bank_transactions (import_id, company_id, posted_at, description, amount_cents)
  values (v_imp, v_co_a, date_trunc('month', current_date)::date, 'CLIENT DEPOSIT', 400000)
  returning id into v_tx_inc;

  -- ------------------------------------------------------------
  -- 2. A manual expense has no source and is always allowed.
  --    Asserted FIRST: if the constraint were written without the
  --    partial WHERE, this is what would break, and it would break
  --    every hand-entered deduction and every Stripe fee row in the
  --    product. Three of them, to prove nulls do not collide.
  -- ------------------------------------------------------------
  insert into public.monthly_expenses
    (company_id, user_id, tax_year, month, amount_cents, category_code, notes)
  values
    (v_co_a, v_grace, v_year, v_month, 290, 'bank_fees', 'Stripe fee'),
    (v_co_a, v_grace, v_year, v_month, 290, 'bank_fees', 'Stripe fee'),
    (v_co_a, v_grace, v_year, v_month, 175, 'bank_fees', 'Stripe fee');

  select count(*) into v_n from public.monthly_expenses
   where company_id = v_co_a and source_transaction_id is null;
  if v_n <> 3 then
    raise exception 'FAIL: manual expenses with a null source were refused, got % of 3', v_n;
  end if;

  -- ------------------------------------------------------------
  -- 1. A second expense naming the same transaction is refused by the
  --    database itself, with no caller cooperating.
  -- ------------------------------------------------------------
  insert into public.monthly_expenses
    (company_id, user_id, tax_year, month, amount_cents, category_code, notes,
     source_transaction_id)
  values
    (v_co_a, v_grace, v_year, v_month, 20647, 'office',
     'AMZN MKTP US*RT4G91', v_tx)
  returning id into v_exp;

  begin
    insert into public.monthly_expenses
      (company_id, user_id, tax_year, month, amount_cents, category_code, notes,
       source_transaction_id)
    values
      (v_co_a, v_grace, v_year, v_month, 20647, 'office',
       'AMZN MKTP US*RT4G91', v_tx);
    raise exception 'FAIL: the database accepted a second expense for the same transaction';
  exception
    when unique_violation then
      null;  -- exactly the point of this migration
  end;

  select count(*) into v_n from public.monthly_expenses
   where source_transaction_id = v_tx;
  if v_n <> 1 then
    raise exception 'FAIL: % expenses exist for one transaction', v_n;
  end if;

  -- A DIFFERENT transaction may of course have its own expense.
  insert into public.monthly_expenses
    (company_id, user_id, tax_year, month, amount_cents, category_code, notes,
     source_transaction_id)
  values
    (v_co_a, v_grace, v_year, v_month, 4065, 'office',
     'STAPLES 00109382', v_tx2)
  returning id into v_exp2;

  -- Clear the scratch rows so the function assertions below start from
  -- the state a real unbooked import is in.
  delete from public.monthly_expenses where id in (v_exp, v_exp2);

  -- ------------------------------------------------------------
  -- 8. A stranger cannot book this company's transaction.
  -- ------------------------------------------------------------
  begin
    perform public.book_bank_transaction_expense(
      v_tx, v_rival, v_year, v_month, 20647::bigint,
      'office', 'one_off', 'not his company');
    raise exception 'FAIL: a member of another company booked this transaction';
  exception
    when sqlstate '42501' then
      null;
  end;
  select count(*) into v_n from public.monthly_expenses
   where source_transaction_id = v_tx;
  if v_n <> 0 then
    raise exception 'FAIL: the refused call still wrote an expense';
  end if;

  -- ------------------------------------------------------------
  -- 3. The first booking books once and links once.
  -- ------------------------------------------------------------
  v_res := public.book_bank_transaction_expense(
    v_tx, v_grace, v_year, v_month, 20647::bigint,
    'office', 'one_off', 'AMZN MKTP US*RT4G91');
  if (v_res ->> 'status') <> 'booked' then
    raise exception 'FAIL: the first booking reported %', v_res;
  end if;
  v_first := (v_res ->> 'expense_id')::uuid;

  select amount_cents into v_cents from public.monthly_expenses where id = v_first;
  if v_cents <> 20647 then
    raise exception 'FAIL: the booked amount is %, expected 20647', v_cents;
  end if;

  select count(*) into v_n from public.bank_transactions
   where id = v_tx
     and applied_expense_id = v_first
     and applied_category_code = 'office';
  if v_n <> 1 then
    raise exception 'FAIL: the transaction does not point at the expense it just booked';
  end if;

  -- ------------------------------------------------------------
  -- 4 + 5. THE INCIDENT. A second run, same arguments, 21 seconds
  --        later. It must write nothing, raise nothing, and say so.
  -- ------------------------------------------------------------
  v_res := public.book_bank_transaction_expense(
    v_tx, v_grace, v_year, v_month, 20647::bigint,
    'office', 'one_off', 'AMZN MKTP US*RT4G91');
  if (v_res ->> 'status') <> 'already_booked' then
    raise exception 'FAIL: the second booking reported %, expected already_booked', v_res;
  end if;
  v_second := (v_res ->> 'expense_id')::uuid;
  if v_second is distinct from v_first then
    raise exception 'FAIL: the second booking named a different expense (% vs %)', v_second, v_first;
  end if;

  select count(*) into v_n from public.monthly_expenses
   where source_transaction_id = v_tx;
  if v_n <> 1 then
    raise exception 'FAIL: after two bookings there are % expenses for one transaction', v_n;
  end if;

  -- Stated the way the incident was measured: the total, not the count.
  select coalesce(sum(amount_cents), 0) into v_cents
    from public.monthly_expenses where company_id = v_co_a;
  if v_cents <> 20647 + 290 + 290 + 175 then
    raise exception 'FAIL: the company total is %, expected %', v_cents, 20647 + 290 + 290 + 175;
  end if;

  -- ------------------------------------------------------------
  -- 9. A transaction already booked as income is refused.
  -- ------------------------------------------------------------
  insert into public.monthly_income
    (company_id, user_id, tax_year, month, amount_cents, source, recurrence, notes)
  values (v_co_a, v_grace, v_year, v_month, 400000, 'sales', 'one_off', 'CLIENT DEPOSIT')
  returning id into v_exp;  -- reused local, it is an income id here
  update public.bank_transactions set applied_income_id = v_exp where id = v_tx_inc;

  v_res := public.book_bank_transaction_expense(
    v_tx_inc, v_grace, v_year, v_month, 400000::bigint,
    'office', 'one_off', 'CLIENT DEPOSIT');
  if (v_res ->> 'status') <> 'booked_as_income' then
    raise exception 'FAIL: booking an income row as an expense reported %', v_res;
  end if;
  select count(*) into v_n from public.monthly_expenses
   where source_transaction_id = v_tx_inc;
  if v_n <> 0 then
    raise exception 'FAIL: a transaction booked as income also got an expense';
  end if;

  -- ------------------------------------------------------------
  -- 6 + 7. The orphan class. Break the link the way the incident broke
  --        it, confirm the view names it, then confirm a re-book heals
  --        it instead of inserting a second row.
  -- ------------------------------------------------------------
  update public.bank_transactions set applied_expense_id = null where id = v_tx;

  select count(*) into v_n from public.expense_booking_orphans
   where expense_id = v_first;
  if v_n <> 1 then
    raise exception 'FAIL: expense_booking_orphans did not name the orphaned row';
  end if;

  v_res := public.book_bank_transaction_expense(
    v_tx, v_grace, v_year, v_month, 20647::bigint,
    'office', 'one_off', 'AMZN MKTP US*RT4G91');
  if (v_res ->> 'status') <> 'already_booked' then
    raise exception 'FAIL: re-booking an orphaned expense reported %, expected already_booked', v_res;
  end if;
  if (v_res ->> 'expense_id')::uuid <> v_first then
    raise exception 'FAIL: the heal pointed at a different expense';
  end if;

  select count(*) into v_n from public.monthly_expenses
   where source_transaction_id = v_tx;
  if v_n <> 1 then
    raise exception 'FAIL: healing the orphan created a second expense (% now exist)', v_n;
  end if;

  select count(*) into v_n from public.bank_transactions
   where id = v_tx and applied_expense_id = v_first;
  if v_n <> 1 then
    raise exception 'FAIL: the heal did not repoint the transaction at its expense';
  end if;

  select count(*) into v_n from public.expense_booking_orphans
   where company_id = v_co_a;
  if v_n <> 0 then
    raise exception 'FAIL: % orphans remain after the heal', v_n;
  end if;

  -- ------------------------------------------------------------
  -- The invariant, stated once over the whole company: no transaction
  -- has more than one expense, and no expense claims a transaction
  -- that does not claim it back.
  -- ------------------------------------------------------------
  select count(*) into v_n from (
    select source_transaction_id
      from public.monthly_expenses
     where company_id = v_co_a and source_transaction_id is not null
     group by source_transaction_id
    having count(*) > 1
  ) dupes;
  if v_n <> 0 then
    raise exception 'FAIL: % transactions carry more than one expense', v_n;
  end if;

  raise notice 'PASS: source_transaction_id and book_bank_transaction_expense, all 9 assertions';
end $$;

rollback;
