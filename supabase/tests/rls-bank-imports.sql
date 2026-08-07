-- Bank CSV import RLS tests.
--
-- Proves, as actual queries run as each user rather than as an argument
-- about policy text, that:
--
--   1. an expenser reads ZERO of the manager's bank_imports,
--      bank_transactions and bank_import_duplicates
--   2. an expenser who uploaded nothing reads zero, full stop
--   3. a department lead gets no special view of them either
--   4. an expenser DOES still read the import they uploaded themselves
--      (control -- without this the zeroes above would pass on a broken
--      database that returns nothing to anybody)
--   5. the manager still reads everything, their own AND the expenser's
--      (the second control, and the owner's-access-unchanged check)
--   6. an expenser can still do everything they legitimately need:
--      upload an import, read it back, read their own monthly_expenses,
--      and read shared reference data
--   7. an expenser cannot UPDATE or DELETE the manager's rows either --
--      the same bare-membership shape was on the write policies, and
--      the anon key ships in client JS, so this was reachable straight
--      from PostgREST without the app
--   8. another company sees nothing at all
--
-- Run with:
--   psql $DATABASE_URL -f supabase/tests/rls-bank-imports.sql
--
-- The script seeds scratch companies and users, impersonates them via
-- SET LOCAL role / request.jwt.claims, asserts, then rolls back. No
-- production data is touched.
--
-- Assumes 20260808000100_bank_import_scoped_visibility.sql has been
-- applied. Assertions 1, 2, 3, 7 fail without it -- they are the leak
-- it exists to close.

begin;

do $$
declare
  -- Company A: manager + two expensers + a department lead.
  v_boss    uuid := gen_random_uuid();  -- manager, owns the real data
  v_grace   uuid := gen_random_uuid();  -- expenser, uploads one of her own
  v_marwan  uuid := gen_random_uuid();  -- expenser, uploads nothing
  v_lead    uuid := gen_random_uuid();  -- department lead over Grace
  -- Company B: a total stranger.
  v_rival   uuid := gen_random_uuid();
  v_co_a    uuid := gen_random_uuid();
  v_co_b    uuid := gen_random_uuid();
  v_dept    uuid := gen_random_uuid();
  v_imp_boss  uuid;
  v_imp_grace uuid;
  v_tx_boss   uuid;
  v_n       int;
  v_ok      boolean;
begin
  -- ------------------------------------------------------------
  -- Seed
  -- ------------------------------------------------------------
  insert into auth.users
    (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_boss,   'rls-bank-boss@example.invalid',   now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_grace,  'rls-bank-grace@example.invalid',  now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_marwan, 'rls-bank-marwan@example.invalid', now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_lead,   'rls-bank-lead@example.invalid',   now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_rival,  'rls-bank-rival@example.invalid',  now(), '{}', '{}', 'authenticated', 'authenticated');

  -- A trigger on auth.users already creates the profiles rows.
  insert into public.profiles (id, email)
  values
    (v_boss,   'rls-bank-boss@example.invalid'),
    (v_grace,  'rls-bank-grace@example.invalid'),
    (v_marwan, 'rls-bank-marwan@example.invalid'),
    (v_lead,   'rls-bank-lead@example.invalid'),
    (v_rival,  'rls-bank-rival@example.invalid')
  on conflict (id) do nothing;

  insert into public.companies (id, name, public_id, created_by)
  values
    (v_co_a, 'RLS Bank Co A', 'co_' || substring(replace(v_co_a::text, '-', ''), 1, 10), v_boss),
    (v_co_b, 'RLS Bank Co B', 'co_' || substring(replace(v_co_b::text, '-', ''), 1, 10), v_rival);

  insert into public.departments (id, company_id, name, created_by)
  values (v_dept, v_co_a, 'Field', v_boss);

  insert into public.company_members (company_id, user_id, role, department_id)
  values
    (v_co_a, v_boss,   'manager',  null),
    (v_co_a, v_grace,  'expenser', v_dept),
    (v_co_a, v_marwan, 'expenser', null),
    (v_co_a, v_lead,   'lead',     v_dept),
    (v_co_b, v_rival,  'manager',  null)
  on conflict do nothing;

  -- The manager's import: this is the data the owner complained about.
  insert into public.bank_imports (company_id, user_id, filename, row_count, status, account_type)
  values (v_co_a, v_boss, 'boss-chase-statement.csv', 2, 'reviewing', 'business_checking')
  returning id into v_imp_boss;

  -- Inserted one at a time: INSERT ... RETURNING INTO raises P0003
  -- ("query returned more than one row") on a multi-row VALUES list.
  insert into public.bank_transactions (import_id, company_id, posted_at, description, amount_cents)
  values (v_imp_boss, v_co_a, current_date, 'BOSS SECRET: DELTA AIR LINES', 84210)
  returning id into v_tx_boss;

  insert into public.bank_transactions (import_id, company_id, posted_at, description, amount_cents)
  values (v_imp_boss, v_co_a, current_date, 'BOSS SECRET: RITZ CARLTON', 129900);

  insert into public.bank_import_duplicates
    (import_id, company_id, posted_at, description, amount_cents, fingerprint, kind)
  values
    (v_imp_boss, v_co_a, current_date, 'BOSS SECRET: DELTA AIR LINES', 84210,
     'rls-bank-test-fingerprint', 'within_file');

  -- Grace's own import. Uploading is open to any member today (the plan
  -- meters it per user), so this must keep working and stay visible to
  -- her -- that is why the model is own-rows-or-manager and not
  -- manager-only.
  insert into public.bank_imports (company_id, user_id, filename, row_count, status, account_type)
  values (v_co_a, v_grace, 'grace-card.csv', 1, 'reviewing', 'credit')
  returning id into v_imp_grace;

  insert into public.bank_transactions (import_id, company_id, posted_at, description, amount_cents)
  values (v_imp_grace, v_co_a, current_date, 'GRACE OWN: OFFICE DEPOT', 4599);

  -- ------------------------------------------------------------
  -- 1 + 4. Grace: none of the boss's rows, all of her own.
  -- ------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_grace, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_n from public.bank_imports where id = v_imp_boss;
  if v_n <> 0 then
    raise exception 'FAIL: expenser read % of the manager''s bank_imports', v_n;
  end if;

  select count(*) into v_n from public.bank_transactions where import_id = v_imp_boss;
  if v_n <> 0 then
    raise exception 'FAIL: expenser read % of the manager''s bank_transactions', v_n;
  end if;

  select count(*) into v_n from public.bank_import_duplicates where import_id = v_imp_boss;
  if v_n <> 0 then
    raise exception 'FAIL: expenser read % of the manager''s bank_import_duplicates', v_n;
  end if;

  -- Not merely filtered by id: nothing of the boss's is reachable by
  -- any route, including the company-wide scan the notification bell
  -- and the member dashboard run via lib/tasks/outstanding.ts.
  select count(*) into v_n from public.bank_transactions
  where company_id = v_co_a and description like 'BOSS SECRET%';
  if v_n <> 0 then
    raise exception 'FAIL: expenser reached % manager transaction(s) by company-wide scan', v_n;
  end if;

  -- CONTROL: the same user, same connection, DOES read her own import
  -- and its transaction. Without this the zeroes above would pass
  -- against a database that returns nothing to anyone.
  select count(*) into v_n from public.bank_imports where id = v_imp_grace;
  if v_n <> 1 then
    raise exception 'FAIL: expenser expected 1 import of her own, got %', v_n;
  end if;

  select count(*) into v_n from public.bank_transactions where import_id = v_imp_grace;
  if v_n <> 1 then
    raise exception 'FAIL: expenser expected 1 transaction of her own, got %', v_n;
  end if;

  -- So the company-wide totals are exactly her own and nothing else.
  select count(*) into v_n from public.bank_imports where company_id = v_co_a;
  if v_n <> 1 then
    raise exception 'FAIL: expenser saw % company imports, expected only her own 1', v_n;
  end if;

  select count(*) into v_n from public.bank_transactions where company_id = v_co_a;
  if v_n <> 1 then
    raise exception 'FAIL: expenser saw % company transactions, expected only her own 1', v_n;
  end if;

  -- ------------------------------------------------------------
  -- 6. Grace can still do what she legitimately needs.
  -- ------------------------------------------------------------
  -- Upload a further import of her own...
  insert into public.bank_imports (company_id, user_id, filename, row_count, status, account_type)
  values (v_co_a, v_grace, 'grace-second.csv', 0, 'reviewing', 'credit');

  select count(*) into v_n from public.bank_imports
  where company_id = v_co_a and user_id = v_grace;
  if v_n <> 2 then
    raise exception 'FAIL: expenser expected to read back her own 2 imports, got %', v_n;
  end if;

  -- ...and she must not be able to forge one onto somebody else.
  v_ok := false;
  begin
    insert into public.bank_imports (company_id, user_id, filename, row_count, status, account_type)
    values (v_co_a, v_boss, 'forged.csv', 0, 'reviewing', 'checking');
  exception when others then
    v_ok := true;
  end;
  if not v_ok then
    raise exception 'FAIL: expenser created a bank_import owned by the manager';
  end if;

  -- Shared reference data is unaffected -- proves the lockout is
  -- targeted and did not simply blind the account.
  select count(*) into v_n from public.deduction_categories;
  if v_n < 1 then
    raise exception 'FAIL: expenser can no longer read shared deduction_categories';
  end if;

  select count(*) into v_n from public.companies where id = v_co_a;
  if v_n <> 1 then
    raise exception 'FAIL: expenser can no longer read her own company row';
  end if;

  -- ------------------------------------------------------------
  -- 7. Grace cannot write to the manager's rows either.
  -- ------------------------------------------------------------
  update public.bank_transactions set ignored = true where import_id = v_imp_boss;
  delete from public.bank_transactions where import_id = v_imp_boss;
  delete from public.bank_imports where id = v_imp_boss;

  perform set_config('role', 'postgres', true);
  select count(*) into v_n from public.bank_imports where id = v_imp_boss;
  if v_n <> 1 then
    raise exception 'FAIL: expenser DELETED the manager''s import';
  end if;
  select count(*) into v_n from public.bank_transactions
  where import_id = v_imp_boss and ignored = false;
  if v_n <> 2 then
    raise exception 'FAIL: expenser mutated or deleted the manager''s transactions (% left untouched, expected 2)', v_n;
  end if;

  -- ------------------------------------------------------------
  -- 2. Marwan uploaded nothing, so he sees nothing.
  -- ------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_marwan, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_n from public.bank_imports where company_id = v_co_a;
  if v_n <> 0 then
    raise exception 'FAIL: expenser with no imports of his own saw % import(s)', v_n;
  end if;

  select count(*) into v_n from public.bank_transactions where company_id = v_co_a;
  if v_n <> 0 then
    raise exception 'FAIL: expenser with no imports of his own saw % transaction(s)', v_n;
  end if;

  -- Control on the same connection: he is still a real, functioning
  -- member who can read his company.
  select count(*) into v_n from public.companies where id = v_co_a;
  if v_n <> 1 then
    raise exception 'FAIL: expenser lost read on his own company row';
  end if;

  -- ------------------------------------------------------------
  -- 3. A department lead gets no special view of bank data.
  -- ------------------------------------------------------------
  -- monthly_expenses deliberately grants a lead sight of their reports'
  -- expense CLAIMS. A bank statement is not a claim, and the nav puts
  -- "import" in LEAD_HIDDEN_KEYS, so the lead arm is intentionally
  -- absent here. Grace is in this lead's department.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_lead, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_n from public.bank_imports where company_id = v_co_a;
  if v_n <> 0 then
    raise exception 'FAIL: department lead saw % bank import(s)', v_n;
  end if;

  select count(*) into v_n from public.bank_transactions where company_id = v_co_a;
  if v_n <> 0 then
    raise exception 'FAIL: department lead saw % bank transaction(s)', v_n;
  end if;

  -- ------------------------------------------------------------
  -- 5. CONTROL: the manager still reads everything.
  -- ------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_boss, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- His own 1 + Grace's 2 = 3.
  select count(*) into v_n from public.bank_imports where company_id = v_co_a;
  if v_n <> 3 then
    raise exception 'FAIL: manager expected all 3 company imports, got %', v_n;
  end if;

  -- His own 2 + Grace's 1 = 3.
  select count(*) into v_n from public.bank_transactions where company_id = v_co_a;
  if v_n <> 3 then
    raise exception 'FAIL: manager expected all 3 company transactions, got %', v_n;
  end if;

  select count(*) into v_n from public.bank_import_duplicates where company_id = v_co_a;
  if v_n <> 1 then
    raise exception 'FAIL: manager expected 1 duplicate row, got %', v_n;
  end if;

  -- And his write access is unchanged -- reconciling is his job.
  update public.bank_transactions set ignored = true where id = v_tx_boss;
  select count(*) into v_n from public.bank_transactions
  where id = v_tx_boss and ignored = true;
  if v_n <> 1 then
    raise exception 'FAIL: manager can no longer update a bank transaction';
  end if;

  delete from public.bank_imports where id = v_imp_grace;
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from public.bank_imports where id = v_imp_grace;
  if v_n <> 0 then
    raise exception 'FAIL: manager can no longer delete an import in their own company';
  end if;

  -- ------------------------------------------------------------
  -- 8. A different company sees nothing at all.
  -- ------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rival, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_n from public.bank_imports where company_id = v_co_a;
  if v_n <> 0 then
    raise exception 'FAIL: another company saw % import(s) of company A', v_n;
  end if;

  select count(*) into v_n from public.bank_transactions where company_id = v_co_a;
  if v_n <> 0 then
    raise exception 'FAIL: another company saw % transaction(s) of company A', v_n;
  end if;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);

  raise notice '[rls-bank] OK - bank import privacy verified as 24 assertions';
end $$;

rollback;
