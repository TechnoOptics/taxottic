-- Recovered 20260429145005 (teams_chat_part3_messages_seed) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Bring team_messages onto conversations and seed General channels.

alter table public.team_messages
  add column if not exists conversation_id uuid references public.chat_conversations(id) on delete cascade;

-- Seed General channel for every company that doesn't have one.
insert into public.chat_conversations (company_id, kind, name, is_default, created_by)
select c.id,
       'channel',
       'General',
       true,
       (select user_id from public.company_members cm
          where cm.company_id = c.id and cm.role = 'manager'
          order by joined_at limit 1)
from public.companies c
where not exists (
  select 1 from public.chat_conversations cc
  where cc.company_id = c.id and cc.is_default
);

-- Backfill orphan messages onto General.
update public.team_messages tm
set conversation_id = (
  select cc.id from public.chat_conversations cc
  where cc.company_id = tm.company_id and cc.is_default
  limit 1
)
where conversation_id is null;

alter table public.team_messages
  alter column conversation_id set not null;

create index if not exists team_messages_conversation_idx
  on public.team_messages (conversation_id, created_at desc);

drop policy if exists "team_messages: company member read" on public.team_messages;
drop policy if exists "team_messages: own insert" on public.team_messages;
drop policy if exists "team_messages: own or manager delete" on public.team_messages;

create policy "team_messages: conv read"
  on public.team_messages for select
  using (public.can_access_conversation(conversation_id));

create policy "team_messages: conv insert"
  on public.team_messages for insert
  with check (
    user_id = auth.uid()
    and public.can_access_conversation(conversation_id)
  );

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
