-- Recovered 20260429003343 (team_chat) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Per-company team chat. Members of the same company can read every
-- message in that company's room and post their own. Messages are
-- soft-immutable (no edit yet); managers can delete via a separate path
-- if abuse comes up. We deliberately don't add channels / threads in
-- this first cut; everyone in the company sees one room.

create table if not exists public.team_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists team_messages_company_created_idx
  on public.team_messages (company_id, created_at desc);

alter table public.team_messages enable row level security;

-- Read: any member of the company.
drop policy if exists "team_messages: company member read" on public.team_messages;
create policy "team_messages: company member read"
  on public.team_messages for select
  using (
    exists (
      select 1 from public.company_members cm
      where cm.company_id = team_messages.company_id
        and cm.user_id = auth.uid()
    )
  );

-- Insert: must post as themselves AND must be a member of the company.
drop policy if exists "team_messages: own insert" on public.team_messages;
create policy "team_messages: own insert"
  on public.team_messages for insert
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.company_members cm
      where cm.company_id = team_messages.company_id
        and cm.user_id = auth.uid()
    )
  );

-- Delete: own message, or the company manager.
drop policy if exists "team_messages: own or manager delete" on public.team_messages;
create policy "team_messages: own or manager delete"
  on public.team_messages for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.company_members cm
      where cm.company_id = team_messages.company_id
        and cm.user_id = auth.uid()
        and cm.role = 'manager'
    )
  );

-- Enable Postgres realtime so clients can subscribe to inserts.
-- The supabase_realtime publication already exists by default; we just
-- add this table to it. ALTER PUBLICATION is idempotent if the table is
-- already a member, but we wrap in a guard for safety.
do $$ begin
  alter publication supabase_realtime add table public.team_messages;
exception
  when duplicate_object then null;
  when others then null;
end $$;
