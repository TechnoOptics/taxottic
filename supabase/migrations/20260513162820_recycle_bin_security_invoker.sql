-- Recovered 20260513162820 (recycle_bin_security_invoker) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Fix: the recycle_bin view added in migration 20260513000001 was
-- created without `security_invoker = true`, which in Postgres 15+
-- means it inherits SECURITY DEFINER semantics by default. That
-- would bypass RLS on the underlying tables (companies +
-- bank_connections + company_members) and let any authenticated
-- user read the entire recycle bin instead of just their own rows.
-- Caught by the Supabase security advisor immediately after the
-- migration applied.
--
-- security_invoker = true makes the view enforce permissions and
-- RLS based on the CALLER's role, which is the correct behavior:
-- the view's WHERE clause filters to the requesting user via
-- company_members, and RLS on each underlying table provides the
-- belt-and-braces second check.
alter view public.recycle_bin set (security_invoker = true);
