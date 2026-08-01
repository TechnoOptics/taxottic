-- Chat conversation RLS tests.
--
-- Proves, as actual queries run as each user rather than as an
-- argument about policy text, that:
--
--   1. a company member who is NOT in a DM reads none of it
--   2. a company member who is NOT in a group reads none of it
--   3. neither of them can even see the conversation row
--   4. a different company sees nothing at all
--   5. actual participants DO read their own conversations (control --
--      without this the other assertions would pass on a broken
--      database that returns nothing to anybody)
--   6. a DM can never gain a third participant
--   7. a former employee loses access the moment their company seat goes
--   8. a group member can be removed by the creator or a manager, and
--      by nobody else
--
-- Run with:
--   psql $DATABASE_URL -f supabase/tests/rls-chat-conversations.sql
--
-- The script seeds scratch companies and users, impersonates them via
-- SET LOCAL role / request.jwt.claims, asserts, then rolls back. No
-- production data is touched.
--
-- Assumes 20260801000100_chat_conversation_access_hardening.sql has
-- been applied. Assertions 6, 7 and 8 fail without it -- they are the
-- regressions it exists to prevent.

begin;

do $$
declare
  -- Company A: manager + two employees.
  v_boss    uuid := gen_random_uuid();
  v_alice   uuid := gen_random_uuid();
  v_bob     uuid := gen_random_uuid();
  v_nosy    uuid := gen_random_uuid();  -- in the company, in nothing else
  -- Company B: a total stranger.
  v_rival   uuid := gen_random_uuid();
  v_co_a    uuid := gen_random_uuid();
  v_co_b    uuid := gen_random_uuid();
  v_dm      uuid;
  v_group   uuid;
  v_channel uuid;
  v_n       int;
  v_ok      boolean;
begin
  -- ------------------------------------------------------------
  -- Seed
  -- ------------------------------------------------------------
  insert into auth.users
    (id, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  values
    (v_boss,  'rls-chat-boss@example.invalid',  now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_alice, 'rls-chat-alice@example.invalid', now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_bob,   'rls-chat-bob@example.invalid',   now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_nosy,  'rls-chat-nosy@example.invalid',  now(), '{}', '{}', 'authenticated', 'authenticated'),
    (v_rival, 'rls-chat-rival@example.invalid', now(), '{}', '{}', 'authenticated', 'authenticated');

  -- A trigger on auth.users already creates the profiles rows.
  insert into public.profiles (id, email)
  values
    (v_boss,  'rls-chat-boss@example.invalid'),
    (v_alice, 'rls-chat-alice@example.invalid'),
    (v_bob,   'rls-chat-bob@example.invalid'),
    (v_nosy,  'rls-chat-nosy@example.invalid'),
    (v_rival, 'rls-chat-rival@example.invalid')
  on conflict (id) do nothing;

  insert into public.companies (id, name, public_id, created_by)
  values
    (v_co_a, 'RLS Chat Co A', 'co_' || substring(replace(v_co_a::text, '-', ''), 1, 10), v_boss),
    (v_co_b, 'RLS Chat Co B', 'co_' || substring(replace(v_co_b::text, '-', ''), 1, 10), v_rival);

  insert into public.company_members (company_id, user_id, role)
  values
    (v_co_a, v_boss,  'manager'),
    (v_co_a, v_alice, 'expenser'),
    (v_co_a, v_bob,   'expenser'),
    (v_co_a, v_nosy,  'expenser'),
    (v_co_b, v_rival, 'manager')
  on conflict do nothing;

  -- The company-insert trigger seeds a General channel for each.
  select id into v_channel from public.chat_conversations
  where company_id = v_co_a and is_default;
  if v_channel is null then
    insert into public.chat_conversations (company_id, kind, name, is_default, created_by)
    values (v_co_a, 'channel', 'General', true, v_boss)
    returning id into v_channel;
  end if;

  -- Alice <-> Bob private DM.
  insert into public.chat_conversations (company_id, kind, name, created_by)
  values (v_co_a, 'dm', null, v_alice)
  returning id into v_dm;
  insert into public.chat_conversation_members (conversation_id, user_id)
  values (v_dm, v_alice), (v_dm, v_bob);
  insert into public.team_messages (company_id, conversation_id, user_id, body)
  values (v_co_a, v_dm, v_alice, 'DM SECRET: I am interviewing elsewhere');

  -- Private group: boss + alice. Bob and Nosy are not in it.
  insert into public.chat_conversations (company_id, kind, name, created_by)
  values (v_co_a, 'group', 'Payroll', v_boss)
  returning id into v_group;
  insert into public.chat_conversation_members (conversation_id, user_id)
  values (v_group, v_boss), (v_group, v_alice);
  insert into public.team_messages (company_id, conversation_id, user_id, body)
  values (v_co_a, v_group, v_boss, 'GROUP SECRET: raise numbers');

  -- Everyone can see the channel, so it is a useful control.
  insert into public.team_messages (company_id, conversation_id, user_id, body)
  values (v_co_a, v_channel, v_boss, 'Public: standup at 9');

  -- ------------------------------------------------------------
  -- 1-3. The colleague who is in neither the DM nor the group.
  -- ------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_nosy, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_n from public.team_messages where conversation_id = v_dm;
  if v_n <> 0 then
    raise exception 'FAIL: non-participant read % message(s) of a private DM', v_n;
  end if;

  select count(*) into v_n from public.team_messages where conversation_id = v_group;
  if v_n <> 0 then
    raise exception 'FAIL: non-member read % message(s) of a private group', v_n;
  end if;

  -- Not merely filtered per-row: the conversation itself is invisible.
  select count(*) into v_n from public.chat_conversations
  where id in (v_dm, v_group);
  if v_n <> 0 then
    raise exception 'FAIL: non-participant saw % private conversation row(s)', v_n;
  end if;

  select count(*) into v_n from public.chat_conversation_members
  where conversation_id in (v_dm, v_group);
  if v_n <> 0 then
    raise exception 'FAIL: non-participant saw % private membership row(s)', v_n;
  end if;

  -- Control: the same user CAN see the open channel, so the zeroes
  -- above are the policy working and not a dead connection.
  select count(*) into v_n from public.team_messages where conversation_id = v_channel;
  if v_n <> 1 then
    raise exception 'FAIL: company member expected 1 channel message, got %', v_n;
  end if;

  -- ------------------------------------------------------------
  -- 4. A different company sees nothing, not even the channel.
  -- ------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_rival, 'role', 'authenticated')::text, true);

  select count(*) into v_n from public.chat_conversations
  where company_id = v_co_a;
  if v_n <> 0 then
    raise exception 'FAIL: another company saw % conversation(s) of company A', v_n;
  end if;

  select count(*) into v_n from public.team_messages where company_id = v_co_a;
  if v_n <> 0 then
    raise exception 'FAIL: another company read % message(s) of company A', v_n;
  end if;

  -- ------------------------------------------------------------
  -- 5. Control: participants read their own conversations.
  -- ------------------------------------------------------------
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);

  select count(*) into v_n from public.team_messages where conversation_id = v_dm;
  if v_n <> 1 then
    raise exception 'FAIL: DM participant expected 1 message, got %', v_n;
  end if;

  -- ...and Bob, who is not in the group, still cannot read it.
  select count(*) into v_n from public.team_messages where conversation_id = v_group;
  if v_n <> 0 then
    raise exception 'FAIL: DM participant read % message(s) of an unrelated group', v_n;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.team_messages
  where conversation_id in (v_dm, v_group);
  if v_n <> 2 then
    raise exception 'FAIL: Alice is in both the DM and the group, expected 2 messages, got %', v_n;
  end if;

  -- ------------------------------------------------------------
  -- 6. A 1:1 DM can never gain a third participant.
  -- ------------------------------------------------------------
  -- Alice is a DM participant and its creator, which is the strongest
  -- position anyone can hold, and it still must not work.
  v_ok := false;
  begin
    insert into public.chat_conversation_members (conversation_id, user_id)
    values (v_dm, v_nosy);
  exception when others then
    v_ok := true;
  end;
  if not v_ok then
    raise exception
      'FAIL: a DM participant added a third person to a 1:1 DM';
  end if;

  -- Nor may either half of a DM evict the other. Checked here, while
  -- Bob is still an employee, because assertion 7 removes him.
  delete from public.chat_conversation_members
  where conversation_id = v_dm and user_id = v_bob;

  perform set_config('role', 'postgres', true);
  select count(*) into v_n from public.chat_conversation_members
  where conversation_id = v_dm and user_id = v_bob;
  if v_n <> 1 then
    raise exception 'FAIL: a DM participant evicted the person they were talking to';
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  -- A group, by contrast, is meant to accept a company colleague.
  insert into public.chat_conversation_members (conversation_id, user_id)
  values (v_group, v_bob);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  select count(*) into v_n from public.team_messages where conversation_id = v_group;
  if v_n <> 1 then
    raise exception 'FAIL: newly added group member expected 1 message, got %', v_n;
  end if;

  -- ------------------------------------------------------------
  -- 7. A former employee loses access with their company seat.
  -- ------------------------------------------------------------
  perform set_config('role', 'postgres', true);
  delete from public.company_members where company_id = v_co_a and user_id = v_bob;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_bob, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_n from public.team_messages
  where conversation_id in (v_dm, v_group, v_channel);
  if v_n <> 0 then
    raise exception
      'FAIL: a former employee still read % chat message(s) of their old company', v_n;
  end if;

  -- The stale membership rows are cleared too, so the group's member
  -- list stops listing someone who no longer works here.
  perform set_config('role', 'postgres', true);
  select count(*) into v_n from public.chat_conversation_members
  where user_id = v_bob;
  if v_n <> 0 then
    raise exception
      'FAIL: % stale conversation membership row(s) survived the company removal', v_n;
  end if;

  -- ------------------------------------------------------------
  -- 8. Removal from a group: creator or manager only.
  -- ------------------------------------------------------------
  insert into public.chat_conversation_members (conversation_id, user_id)
  values (v_group, v_nosy);

  -- Alice is in the group but is neither its creator nor a manager.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_alice, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  delete from public.chat_conversation_members
  where conversation_id = v_group and user_id = v_nosy;

  perform set_config('role', 'postgres', true);
  select count(*) into v_n from public.chat_conversation_members
  where conversation_id = v_group and user_id = v_nosy;
  if v_n <> 1 then
    raise exception
      'FAIL: a plain group member removed somebody else from the group';
  end if;

  -- The boss created the group and is a manager, so this must work.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_boss, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  delete from public.chat_conversation_members
  where conversation_id = v_group and user_id = v_nosy;

  perform set_config('role', 'postgres', true);
  select count(*) into v_n from public.chat_conversation_members
  where conversation_id = v_group and user_id = v_nosy;
  if v_n <> 0 then
    raise exception 'FAIL: the group creator could not remove a member';
  end if;

  perform set_config('request.jwt.claims', '', true);

  raise notice '[rls-chat] OK - DM and group privacy verified as 8 assertions';
end $$;

rollback;
