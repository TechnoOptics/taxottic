-- Recovered 20260503185254 (tei_simplify_anon_insert) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.


-- Replace with the simplest possible permissive INSERT policy for anon.
-- Validation already happens at the API route layer, plus the table has
-- check constraints on status. We don't need to duplicate body validation
-- in the policy.
drop policy if exists "anon can submit inquiry" on public.taxottic_enterprise_inquiries;

create policy "anon can submit inquiry"
  on public.taxottic_enterprise_inquiries
  as permissive
  for insert
  to anon
  with check (true);
