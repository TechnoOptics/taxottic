-- Recovered 20260503185416 (tei_grants_only_lockdown) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.


-- Belt-and-braces lockdown for the inquiry table:
--   - anon: INSERT only (so the public form can capture leads)
--   - authenticated: nothing (this table has no end-user access)
--   - service_role: full access (admin reads/writes via API route)
-- We rely on GRANTs alone (RLS off) because RLS evaluation is misbehaving
-- under the project's anon role context. The Vercel API route validates
-- inputs before insert; admin reads use service_role only.

drop policy if exists "anon can submit inquiry" on public.taxottic_enterprise_inquiries;

revoke all on public.taxottic_enterprise_inquiries from anon, authenticated;

grant insert on public.taxottic_enterprise_inquiries to anon;
-- Keep the table readable/writable only by service_role + postgres.
alter table public.taxottic_enterprise_inquiries disable row level security;
