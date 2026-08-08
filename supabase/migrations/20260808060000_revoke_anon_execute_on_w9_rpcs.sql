-- The W-9 RPCs were callable by `anon` straight through PostgREST.
--
-- `lookup_w9_request(text)` and `submit_w9_form(...)` are SECURITY DEFINER
-- and were EXECUTE-granted to `anon` and `authenticated`, so anyone on the
-- internet could invoke them at /rest/v1/rpc/ with only a token, entirely
-- bypassing the application.
--
-- Two things that made it worse than a plain token check:
--
--  1. `submit_w9_form` assigns `tin_digits = p_tin_digits` verbatim. The
--     encryption lives in app/w9/[token]/actions.ts, NOT in the function,
--     so a direct caller writes a plaintext TIN into the column that is
--     supposed to hold ciphertext.
--  2. Its WHERE clause accepts `status in ('requested','received')`, so a
--     token holder can overwrite an ALREADY SIGNED W-9, including
--     signed_ip and signed_user_agent, for the full 90-day token life.
--
-- Revoking is safe and changes no behaviour: both call sites use the
-- service-role client, which is not affected by these grants.
--   app/w9/[token]/page.tsx:31    lookup_w9_request via createServiceClient()
--   app/w9/[token]/actions.ts:84  submit_w9_form   via createServiceClient()
--
-- Mirrors 20260802041109_revoke_anon_execute_on_internal_rpcs.sql, which
-- did the same for mileage_broken_trips, purge_expired_recycle_bin and
-- passkey_lookup_by_email, and is the proven template.
--
-- NOTE the remaining work this does NOT do, so it is not mistaken for a
-- complete fix of the finding: the function bodies still accept a
-- plaintext TIN and still allow re-signing a completed form. Those want a
-- `signed_at is null` guard and a ciphertext check inside the functions,
-- so the grant is not the only control. Tracked separately.

do $$
declare
  fn record;
begin
  -- Loop over overloads by OID so a signature change cannot silently make
  -- this migration a no-op, which is exactly how a revoke gets lost.
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('lookup_w9_request', 'submit_w9_form')
  loop
    execute format(
      'revoke execute on function %s from anon, authenticated, public',
      fn.sig
    );
    raise notice 'revoked anon/authenticated/public EXECUTE on %', fn.sig;
  end loop;
end $$;
