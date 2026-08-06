-- Recovered 20260503184603 (tei_anon_insert_policy) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.


-- Allow anonymous INSERTs into the inquiry table so the public form can
-- capture leads with the anon key (no service-role required for writes).
-- All admin reads/updates still go through service_role only.
create policy "anon can submit inquiry"
  on public.taxottic_enterprise_inquiries
  for insert
  to anon
  with check (
    -- Must supply the required fields and a status of 'new' (or default).
    char_length(firm_name) between 1 and 200
    and char_length(contact_name) between 1 and 200
    and char_length(contact_email) between 3 and 320
    and char_length(coalesce(prospect_notes, '')) <= 8000
    and (status is null or status = 'new')
  );
