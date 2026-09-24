-- The Techno Optics fleet contract's section 6.8 test, against the real
-- mechanism.
--
--   "A user created via provision_user cannot read any row belonging to a
--    production tenant. Run against the real mechanism, not a mock."
--
-- The real mechanism is Postgres row-level security, so this is a psql
-- script, not a unit test. It proves both directions of section 6.1:
--
--   nothing real gets in       a sandbox session sees no real tenant's rows
--   nothing sandboxed gets out a real session, INCLUDING a super-admin
--                              session, sees no sandbox row, and
--                              report_counts does not move
--
-- Run with:
--   psql $DATABASE_URL -f supabase/tests/rls-hq-sandbox-isolation.sql
--
-- Same shape as supabase/tests/rls-tier2-isolation.sql: creates scratch
-- rows, impersonates via set_config('role') + request.jwt.claims, asserts
-- with `raise exception 'FAIL ...'`, then rolls back. No production data is
-- touched and nothing survives the transaction.
--
-- PRECONDITION: supabase/migrations/20260819010000_hq_sandbox_boundary.sql
-- must be applied. Without it this script fails at the first statement with
-- `column "sandbox" does not exist`, which is the correct failure: the
-- boundary is what is being tested, and the test must not pass when the
-- boundary is absent. That was verified before the migration was written.
--
-- RUN HISTORY
--
-- 2026-08-22, against production, both halves observed:
--
--   before the migration, the seed failed with
--     42703: column "sandbox" of relation "companies" does not exist
--   after the migration, every assertion passed and the transaction was
--     rolled back with 6 companies unchanged and zero residue.
--
-- The first run also found a defect in THIS script rather than in the
-- boundary: chat_conversations carries a check constraint requiring a
-- name for any kind other than 'dm', so the two channel inserts below
-- aborted the transaction before a single assertion was reached. The
-- script had been written, reviewed and merged without ever being
-- executed, which is the exact failure mode this repository keeps
-- meeting: code that exists, type-checks, and is never run.

begin;

do $$
declare
  v_real_user     uuid;
  v_sandbox_user  uuid;
  v_admin_user    uuid;
  v_real_co       uuid;
  v_sandbox_co    uuid;
  v_real_trip     uuid;
  v_sandbox_trip  uuid;
  v_real_conv     uuid;
  v_sandbox_conv  uuid;
  v_count         int;
  v_counts_before int;
  v_counts_after  int;
begin
  v_real_user    := gen_random_uuid();
  v_sandbox_user := gen_random_uuid();
  v_admin_user   := gen_random_uuid();
  v_real_co      := gen_random_uuid();
  v_sandbox_co   := gen_random_uuid();

  -- ----------------------------------------------------------------
  -- Setup. Runs as the connection's own role (postgres), so RLS is
  -- not in the way of seeding.
  -- ----------------------------------------------------------------
  insert into auth.users
    (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_real_user,    'hq-real@example.invalid',    now(), '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_sandbox_user, 'hq-sandbox@example.invalid', now(), '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_admin_user,   'hq-admin@example.invalid',   now(), '{}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated');

  -- A real tenant holding a real taxpayer's numbers, and a sandbox tenant.
  insert into public.companies (id, name, created_by, sandbox)
  values
    (v_real_co,    'Northgate Cabinetry LLC', v_real_user,    false),
    (v_sandbox_co, 'Harbourline Design Co',   v_sandbox_user, true);

  insert into public.company_members (company_id, user_id, role)
  values
    (v_real_co,    v_real_user,    'manager'),
    (v_sandbox_co, v_sandbox_user, 'manager');

  -- The super-admin is the "admin report that counts all rows" failure mode
  -- from section 6.7: is_super_admin() is ORed into essentially every read
  -- policy in this database, so if anything leaks a sandbox row into a real
  -- surface it will be this session. super_admins is keyed by email, and
  -- is_super_admin() joins auth.users on lower(email).
  insert into public.super_admins (email) values ('hq-admin@example.invalid');

  -- One tenant-scoped row on each side, on a table that carries company_id.
  insert into public.monthly_expenses
    (company_id, user_id, tax_year, month, amount_cents, category_code)
  values
    (v_real_co,    v_real_user,    extract(year from now())::int, 1, 128400, 'supplies'),
    (v_sandbox_co, v_sandbox_user, extract(year from now())::int, 1,  41200, 'supplies');

  -- One row on a table reachable ONLY through a foreign key, which is the
  -- orphan-prone class section 8.1 names and the class a barrier on
  -- company_id tables alone would miss.
  insert into public.mileage_trips
    (company_id, driver_user_id, started_at, ended_at, tax_year)
  values
    (v_real_co, v_real_user, now() - interval '1 hour', now(),
     extract(year from now())::int)
  returning id into v_real_trip;
  insert into public.mileage_trips
    (company_id, driver_user_id, started_at, ended_at, tax_year)
  values
    (v_sandbox_co, v_sandbox_user, now() - interval '1 hour', now(),
     extract(year from now())::int)
  returning id into v_sandbox_trip;

  insert into public.mileage_points (trip_id, captured_at, lat, lng)
  values (v_real_trip, now(), 40.7128, -74.0060), (v_sandbox_trip, now(), 41.8781, -87.6298);

  -- And one row behind a SECURITY DEFINER helper. chat_conversation_members
  -- is gated by can_access_conversation(), which is SECURITY DEFINER and so
  -- does not see the parent's RLS. It does require company membership, so
  -- the leak it leaves open is precisely the user who is a member of a real
  -- company AND a sandbox one. Provisioning must never create that user; the
  -- barrier is what makes the database enforce it rather than the endpoint
  -- remembering to.
  insert into public.chat_conversations (company_id, kind, name, created_by)
  values (v_real_co, 'channel', 'hq-real-scratch', v_real_user) returning id into v_real_conv;
  insert into public.chat_conversations (company_id, kind, name, created_by)
  values (v_sandbox_co, 'channel', 'hq-sandbox-scratch', v_sandbox_user) returning id into v_sandbox_conv;

  insert into public.chat_conversation_members (conversation_id, user_id)
  values (v_real_conv, v_real_user), (v_sandbox_conv, v_sandbox_user);

  -- report_counts, per section 7: every non-sandbox tenant that currently
  -- exists, excluding soft-deleted. Taken here with the sandbox already
  -- present, then again at the end, because the contract's test is that the
  -- number does not move when a sandbox is created and filled.
  select count(*) into v_counts_before
  from public.companies where not sandbox and deleted_at is null;

  raise notice '[hq-sandbox] seed done - real_co=%, sandbox_co=%', v_real_co, v_sandbox_co;

  -- ----------------------------------------------------------------
  -- Direction 1: nothing real gets in.
  -- The sandbox user is the stranger the Hub hands credentials to.
  -- ----------------------------------------------------------------
  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_sandbox_user::text, 'role', 'authenticated')::text,
    true
  );

  if not public.hq_session_is_sandbox() then
    raise exception 'FAIL: a member of a sandbox company is not seen as a sandbox session';
  end if;

  select count(*) into v_count from public.companies where id = v_real_co;
  if v_count > 0 then
    raise exception 'FAIL: sandbox user can see the real company row';
  end if;

  select count(*) into v_count from public.monthly_expenses where company_id = v_real_co;
  if v_count > 0 then
    raise exception 'FAIL: sandbox user can read % real monthly_expenses rows', v_count;
  end if;

  select count(*) into v_count from public.mileage_trips where company_id = v_real_co;
  if v_count > 0 then
    raise exception 'FAIL: sandbox user can read % real mileage_trips rows', v_count;
  end if;

  select count(*) into v_count from public.mileage_points where trip_id = v_real_trip;
  if v_count > 0 then
    raise exception
      'FAIL: sandbox user can read % real mileage_points rows through the trip FK', v_count;
  end if;

  select count(*) into v_count
  from public.chat_conversation_members where conversation_id = v_real_conv;
  if v_count > 0 then
    raise exception
      'FAIL: sandbox user can read % real chat_conversation_members rows', v_count;
  end if;

  -- The sandbox user must still see their OWN tenant, or the boundary has
  -- broken the product rather than isolated it.
  select count(*) into v_count from public.monthly_expenses where company_id = v_sandbox_co;
  if v_count <> 1 then
    raise exception
      'FAIL: sandbox user expected 1 row in their own tenant, got %', v_count;
  end if;

  -- ----------------------------------------------------------------
  -- Direction 2: nothing sandboxed gets out, for an ordinary real user.
  -- ----------------------------------------------------------------
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_real_user::text, 'role', 'authenticated')::text,
    true
  );

  if public.hq_session_is_sandbox() then
    raise exception 'FAIL: a real tenant member is seen as a sandbox session';
  end if;

  select count(*) into v_count from public.companies where sandbox;
  if v_count > 0 then
    raise exception 'FAIL: real user can see % sandbox company rows', v_count;
  end if;

  select count(*) into v_count from public.monthly_expenses where company_id = v_sandbox_co;
  if v_count > 0 then
    raise exception 'FAIL: real user can read % sandbox monthly_expenses rows', v_count;
  end if;

  select count(*) into v_count from public.mileage_points where trip_id = v_sandbox_trip;
  if v_count > 0 then
    raise exception 'FAIL: real user can read % sandbox mileage_points rows', v_count;
  end if;

  select count(*) into v_count from public.monthly_expenses where company_id = v_real_co;
  if v_count <> 1 then
    raise exception 'FAIL: real user lost access to their own tenant, got % rows', v_count;
  end if;

  -- ----------------------------------------------------------------
  -- Direction 2, the hard case: the super-admin.
  -- Failure mode 2 in section 6.7 is "the admin report that counts all
  -- rows". is_super_admin() is ORed into nearly every read policy here, so
  -- this is the session most likely to pull a sandbox row into an internal
  -- report a real person opens.
  -- ----------------------------------------------------------------
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_admin_user::text, 'role', 'authenticated')::text,
    true
  );

  select count(*) into v_count from public.companies where sandbox;
  if v_count > 0 then
    raise exception 'FAIL: super-admin can see % sandbox company rows', v_count;
  end if;

  select count(*) into v_count from public.monthly_expenses where company_id = v_sandbox_co;
  if v_count > 0 then
    raise exception
      'FAIL: super-admin can read % sandbox monthly_expenses rows into an internal report',
      v_count;
  end if;

  -- The super-admin must keep their real cross-tenant reach.
  select count(*) into v_count from public.monthly_expenses where company_id = v_real_co;
  if v_count <> 1 then
    raise exception
      'FAIL: the barrier broke super-admin access to a real tenant, got % rows', v_count;
  end if;

  -- ----------------------------------------------------------------
  -- report_counts is unaffected, before and after.
  -- ----------------------------------------------------------------
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', null, true);

  select count(*) into v_counts_after
  from public.companies where not sandbox and deleted_at is null;

  if v_counts_after <> v_counts_before then
    raise exception
      'FAIL: the real tenant count moved from % to % while a sandbox existed',
      v_counts_before, v_counts_after;
  end if;

  select count(*) into v_count
  from public.companies where sandbox and deleted_at is null;
  if v_count <> 1 then
    raise exception 'FAIL: expected exactly 1 scratch sandbox tenant, found %', v_count;
  end if;

  -- ----------------------------------------------------------------
  -- The straddling user.
  -- A user holding a membership on both sides is the one case membership
  -- checks alone cannot catch, and it is what provision_user must never
  -- create. The barrier resolves it in the safe direction: the session is
  -- sandbox, so the real tenant becomes unreachable, rather than the
  -- sandbox tenant becoming reachable from a real session.
  -- ----------------------------------------------------------------
  insert into public.company_members (company_id, user_id, role)
  values (v_real_co, v_sandbox_user, 'member');

  perform set_config('role', 'authenticated', true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_sandbox_user::text, 'role', 'authenticated')::text,
    true
  );

  select count(*) into v_count from public.monthly_expenses where company_id = v_real_co;
  if v_count > 0 then
    raise exception
      'FAIL: a user holding both a sandbox and a real membership read % real rows', v_count;
  end if;

  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', null, true);

  raise notice
    '[hq-sandbox] OK - boundary holds in both directions across company_id tables, a FK-only child, a SECURITY-DEFINER-gated child, a super-admin session, and a straddling membership';
end $$;

rollback;
