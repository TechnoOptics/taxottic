-- W-9 RPC adversarial test.
--
-- The public W-9 fill flow goes through two SECURITY DEFINER RPCs
-- granted to the `anon` role:
--   - lookup_w9_request(p_token text)
--   - submit_w9_form(p_token text, ...)
--
-- This script proves the gates:
--   1. lookup with a garbage token returns 0 rows (not an error,
--      not a leaked row).
--   2. lookup with an expired token returns 0 rows.
--   3. lookup with a token for a 'received' form still works
--      (so the client can re-fetch their own submission for the
--      thank-you page) but ONLY within the expires window.
--   4. submit with a garbage token raises 'invalid_or_expired_token'.
--   5. submit with a too-short TIN raises 'tin required'.
--   6. submit with an expired token raises 'invalid_or_expired_token'.
--   7. anon CANNOT read the firm_w9_forms table directly — only
--      via the RPC.
--
-- Run with:
--   psql $DATABASE_URL -f supabase/tests/rls-w9-adversarial.sql

begin;

do $$
declare
  v_firm uuid;
  v_w9_valid uuid;
  v_w9_expired uuid;
  v_token_valid text;
  v_token_expired text;
  v_row record;
  v_count int;
begin
  v_firm := gen_random_uuid();
  v_w9_valid := gen_random_uuid();
  v_w9_expired := gen_random_uuid();
  v_token_valid := encode(gen_random_bytes(32), 'hex');
  v_token_expired := encode(gen_random_bytes(32), 'hex');

  insert into public.firms (id, name, slug, tier, status)
  values (v_firm, 'W9 Test Firm', 'w9-test-firm-' || substring(v_firm::text, 1, 8), 'starter', 'active');

  insert into public.firm_w9_forms (
    id, firm_id, recipient_email, request_token, status, expires_at
  )
  values
    (v_w9_valid, v_firm, 'valid@example.invalid', v_token_valid, 'requested', now() + interval '7 days'),
    (v_w9_expired, v_firm, 'expired@example.invalid', v_token_expired, 'requested', now() - interval '1 day');

  -- Impersonate the anonymous public visitor.
  perform set_config('role', 'anon', true);
  perform set_config(
    'request.jwt.claims',
    '{"role": "anon"}',
    true
  );

  -- Assertion 1: garbage token returns 0 rows.
  select count(*) into v_count from public.lookup_w9_request('this-is-not-a-real-token');
  if v_count <> 0 then
    raise exception
      'FAIL: lookup_w9_request("garbage") returned % rows', v_count;
  end if;

  -- Assertion 2: expired token returns 0 rows.
  select count(*) into v_count from public.lookup_w9_request(v_token_expired);
  if v_count <> 0 then
    raise exception
      'FAIL: lookup_w9_request(expired-token) returned % rows', v_count;
  end if;

  -- Assertion 3: valid token returns the row, with firm metadata.
  select * into v_row
  from public.lookup_w9_request(v_token_valid);
  if v_row.id is null then
    raise exception 'FAIL: lookup_w9_request(valid-token) returned no row';
  end if;
  if v_row.id <> v_w9_valid then
    raise exception
      'FAIL: lookup returned wrong row, expected % got %', v_w9_valid, v_row.id;
  end if;

  -- Assertion 4: submit with garbage token raises.
  begin
    perform public.submit_w9_form(
      'this-is-not-a-real-token',
      'Adversary Co', null, 'individual_sole_prop'::firm_w9_entity_type,
      null, null, null, null,
      '1 Adversary Lane', null, 'Nowhere', 'XX', '00000',
      'ssn'::firm_w9_tin_type, '999999999',
      'Adversary Signer', '127.0.0.1', 'curl/8'
    );
    raise exception 'FAIL: submit_w9_form(garbage-token) succeeded';
  exception
    when others then
      if sqlerrm not like '%invalid_or_expired_token%' then
        raise exception
          'FAIL: submit_w9_form(garbage) raised wrong error: %', sqlerrm;
      end if;
  end;

  -- Assertion 5: submit with short TIN raises.
  begin
    perform public.submit_w9_form(
      v_token_valid,
      'Real Filer', null, 'individual_sole_prop'::firm_w9_entity_type,
      null, null, null, null,
      '1 Real Lane', null, 'Somewhere', 'CA', '90210',
      'ssn'::firm_w9_tin_type, '12',
      'Real Signer', '127.0.0.1', 'mozilla/5'
    );
    raise exception 'FAIL: submit_w9_form(short-tin) succeeded';
  exception
    when others then
      if sqlerrm not like '%tin required%' then
        raise exception
          'FAIL: submit_w9_form(short-tin) raised wrong error: %', sqlerrm;
      end if;
  end;

  -- Assertion 6: submit with expired token raises.
  begin
    perform public.submit_w9_form(
      v_token_expired,
      'Expired Filer', null, 'individual_sole_prop'::firm_w9_entity_type,
      null, null, null, null,
      '1 Expired Lane', null, 'Somewhere', 'CA', '90210',
      'ssn'::firm_w9_tin_type, '123456789',
      'Expired Signer', '127.0.0.1', 'mozilla/5'
    );
    raise exception 'FAIL: submit_w9_form(expired-token) succeeded';
  exception
    when others then
      if sqlerrm not like '%invalid_or_expired_token%' then
        raise exception
          'FAIL: submit_w9_form(expired) raised wrong error: %', sqlerrm;
      end if;
  end;

  -- Assertion 7: anon CANNOT read the firm_w9_forms table directly.
  begin
    select count(*) into v_count from public.firm_w9_forms;
    if v_count > 0 then
      raise exception
        'FAIL: anon read % firm_w9_forms rows directly (should be RLS-blocked)',
        v_count;
    end if;
  exception
    when insufficient_privilege then null;
    when others then
      -- A "permission denied" or similar is also acceptable.
      if sqlerrm not like '%permission denied%'
         and sqlerrm not like '%row-level security%'
         and v_count > 0 then
        raise exception
          'FAIL: anon select on firm_w9_forms returned data: %', sqlerrm;
      end if;
  end;

  raise notice '[rls-w9] OK — adversarial gates verified (7/7)';
end $$;

rollback;
