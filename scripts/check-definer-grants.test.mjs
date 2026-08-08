import { describe, expect, it } from "vitest";
import { analyzeMigrationSql } from "./check-definer-grants.mjs";

describe("analyzeMigrationSql", () => {
  it("ignores a plain invoker-rights function", () => {
    // No `security definer`, so PUBLIC EXECUTE grants it only the caller's
    // own privileges and RLS still applies. Not this guard's problem.
    const sql = `
      create function public.add(a int, b int) returns int
      language sql as $$ select a + b $$;
    `;
    expect(analyzeMigrationSql(sql)).toEqual([]);
  });

  // THE CASE THE GUARD EXISTS FOR. This is what mileage_broken_trips,
  // purge_expired_recycle_bin, passkey_lookup_by_email, lookup_w9_request
  // and submit_w9_form all looked like when they shipped: correct-looking
  // SQL that quietly published an internet-facing endpoint.
  it("flags a SECURITY DEFINER function with no revoke", () => {
    const sql = `
      create or replace function public.leaky_thing(p_id uuid)
      returns table (id uuid) language sql security definer as $$
        select id from private_table where id = p_id
      $$;
    `;
    const f = analyzeMigrationSql(sql);
    expect(f).toHaveLength(1);
    expect(f[0].name).toBe("leaky_thing");
    expect(f[0].revoked).toBe(false);
    expect(f[0].allowlisted).toBe(false);
  });

  it("accepts an explicit revoke in the same migration", () => {
    const sql = `
      create function public.safe_thing() returns int
      language sql security definer as $$ select 1 $$;

      revoke execute on function public.safe_thing() from anon, authenticated, public;
    `;
    expect(analyzeMigrationSql(sql)[0].revoked).toBe(true);
  });

  it("accepts the dynamic DO-block revoke used by the W-9 migration", () => {
    // 20260808060000_revoke_anon_execute_on_w9_rpcs.sql loops over OIDs so an
    // overload cannot silently escape the revoke. The names appear in a
    // proname list rather than in a literal REVOKE statement, and the guard
    // has to understand that or it would reject the better pattern.
    const sql = `
      create function public.looped_thing() returns int
      language sql security definer as $$ select 1 $$;

      do $$
      declare fn record;
      begin
        for fn in
          select p.oid::regprocedure as sig from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname in ('looped_thing')
        loop
          execute format('revoke execute on function %s from anon, authenticated, public', fn.sig);
        end loop;
      end $$;
    `;
    expect(analyzeMigrationSql(sql)[0].revoked).toBe(true);
  });

  it("honours the allowlist marker when it carries a reason", () => {
    const sql = `
      -- definer-grant-ok: invite_lookup  anonymous invitees resolve a token
      --                                  before they can have a session
      create function public.invite_lookup(p_token text) returns table (id uuid)
      language sql security definer as $$ select id from invitations $$;
    `;
    const f = analyzeMigrationSql(sql)[0];
    expect(f.allowlisted).toBe(true);
    expect(f.reason).toContain("anonymous invitees");
  });

  it("rejects a bare allowlist marker with no reason", () => {
    // "Someone typed the magic comment" is not a review. The regex requires
    // a non-empty reason after the name, so this does not register at all.
    const sql = `
      -- definer-grant-ok: sneaky
      create function public.sneaky() returns int
      language sql security definer as $$ select 1 $$;
    `;
    const f = analyzeMigrationSql(sql)[0];
    expect(f.allowlisted).toBe(false);
    expect(f.revoked).toBe(false);
  });

  it("judges each function separately when a migration creates several", () => {
    const sql = `
      create function public.one() returns int language sql security definer as $$ select 1 $$;
      create function public.two() returns int language sql as $$ select 2 $$;
      create function public.three() returns int language sql security definer as $$ select 3 $$;
    `;
    const f = analyzeMigrationSql(sql);
    // `two` is invoker-rights and must not appear at all.
    expect(f.map((x) => x.name)).toEqual(["one", "three"]);
  });

  it("handles the create-or-replace and quoted-identifier spellings", () => {
    const sql = `
      create or replace function public."quoted_fn"() returns int
      language plpgsql security definer as $$ begin return 1; end $$;
    `;
    expect(analyzeMigrationSql(sql)[0].name).toBe("quoted_fn");
  });

  it("does not treat a revoke of an unrelated role as sufficient", () => {
    // Revoking from `authenticated` alone leaves anon, which inherits PUBLIC,
    // still able to call it. The whole point is the anon reachability.
    const sql = `
      create function public.half_done() returns int
      language sql security definer as $$ select 1 $$;

      revoke execute on function public.half_done() from authenticated;
    `;
    expect(analyzeMigrationSql(sql)[0].revoked).toBe(false);
  });
});
