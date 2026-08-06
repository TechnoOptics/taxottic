-- Recovered 20260802041109 (revoke_anon_execute_on_internal_rpcs) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Close three SECURITY DEFINER functions reachable by anyone holding the
-- publishable key, with no session at all.
--
-- mileage_broken_trips has no tenant filter in its body, so an anonymous
-- caller could read driver_user_id, company_id and exact drive start and
-- end times across every company. That is a movement schedule keyed to a
-- person and their employer.
--
-- purge_expired_recycle_bin hard-deletes companies and bank_connections
-- past their retention window. An anonymous caller could not choose a
-- target but could fire the purge on demand, destroying the window in
-- which a deletion is still recoverable.
--
-- passkey_lookup_by_email maps an email address to a user id, credential
-- id, public key and counter, unrate-limited. An account-enumeration and
-- auth-identifier oracle.
--
-- Safe to revoke: all three are invoked only through the service-role
-- client (lib/mileage/finalize.ts, app/actions/recycle-bin.ts, and
-- app/api/passkeys/auth/options/route.ts respectively), and the service
-- role bypasses function grants. Passkey sign-in is unaffected.
--
-- Root cause worth a separate fix: Postgres grants EXECUTE to PUBLIC by
-- default, so every new SECURITY DEFINER function in this schema is
-- internet-facing unless someone remembers to revoke it. 36 functions are
-- currently reachable by anon; these three are the ones with no guard.
revoke execute on function public.mileage_broken_trips(timestamp with time zone, integer) from anon, authenticated, public;
revoke execute on function public.purge_expired_recycle_bin() from anon, authenticated, public;
revoke execute on function public.passkey_lookup_by_email(text) from anon, authenticated, public;
