-- Recovered 20260520175259 (badges_celebrated_at) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.badges
  add column if not exists celebrated_at timestamptz;

update public.badges
  set celebrated_at = coalesce(awarded_at, now())
  where celebrated_at is null;

create index if not exists badges_uncelebrated_idx
  on public.badges (user_id)
  where celebrated_at is null;
