-- Recovered 20260428174253 (fix_invitations_rls_use_jwt) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- The previous policy queried auth.users directly, which the `authenticated`
-- role does not have SELECT on. That throws "permission denied for table
-- users" whenever Postgres evaluates the policy, even when the user is in
-- another OR branch. Replace with auth.jwt() lookup, which always works.

drop policy if exists "invites: invitee read by email" on public.invitations;
create policy "invites: invitee read by email"
  on public.invitations for select
  using (
    lower(email) = lower(coalesce(
      (auth.jwt() ->> 'email')::text,
      ''
    ))
  );
