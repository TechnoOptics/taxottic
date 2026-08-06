-- Recovered 20260428215858 (company_member_role_details) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Lightweight role/title metadata for invited employees. All optional.
-- "title" is the human-readable job title (e.g., "Marketing Manager"); the
-- existing `role` enum (manager / member) is the access role.
alter table public.company_members
  add column if not exists title text,
  add column if not exists bio text,
  add column if not exists onboarded_at timestamptz;

-- For new joiners (existing rows pre-date this column), backfill onboarded_at
-- so they don't get prompted again on next login.
update public.company_members
set onboarded_at = joined_at
where onboarded_at is null;
