-- Recovered 20260521072758 (profiles_active_company_id) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- profiles.active_company_id — track which company the user is
-- currently viewing in the app so the watch (a strict companion)
-- always reflects the same company the phone is showing. Side-effect
-- written by the /c/[publicId] layout; read by /api/watch/snapshot.
-- On company delete, the FK clears so we don't carry a dangling
-- reference; the snapshot endpoint falls back to companies[0] in
-- that case.
alter table public.profiles
  add column if not exists active_company_id uuid
    references public.companies(id) on delete set null;

create index if not exists profiles_active_company_id_idx
  on public.profiles (active_company_id)
  where active_company_id is not null;
