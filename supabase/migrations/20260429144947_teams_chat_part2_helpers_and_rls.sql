-- Recovered 20260429144947 (teams_chat_part2_helpers_and_rls) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create or replace function public.can_access_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.chat_conversations c
    where c.id = p_conversation_id
      and (
        (
          c.kind = 'channel' and exists (
            select 1 from public.company_members cm
            where cm.company_id = c.company_id
              and cm.user_id = auth.uid()
          )
        )
        or exists (
          select 1 from public.chat_conversation_members ccm
          where ccm.conversation_id = c.id
            and ccm.user_id = auth.uid()
        )
      )
  );
$$;

grant execute on function public.can_access_conversation(uuid) to authenticated;

alter table public.chat_conversations enable row level security;
alter table public.chat_conversation_members enable row level security;

drop policy if exists "conv: visible" on public.chat_conversations;
create policy "conv: visible"
  on public.chat_conversations for select
  using (public.can_access_conversation(id));

drop policy if exists "conv: company member create" on public.chat_conversations;
create policy "conv: company member create"
  on public.chat_conversations for insert
  with check (
    created_by = auth.uid()
    and exists (
      select 1 from public.company_members cm
      where cm.company_id = chat_conversations.company_id
        and cm.user_id = auth.uid()
    )
  );

drop policy if exists "conv-members: visible" on public.chat_conversation_members;
create policy "conv-members: visible"
  on public.chat_conversation_members for select
  using (public.can_access_conversation(conversation_id));

drop policy if exists "conv-members: insert by member" on public.chat_conversation_members;
create policy "conv-members: insert by member"
  on public.chat_conversation_members for insert
  with check (
    public.can_access_conversation(conversation_id)
    or exists (
      select 1 from public.chat_conversations c
      where c.id = conversation_id
        and c.created_by = auth.uid()
    )
  );

drop policy if exists "conv-members: self leave" on public.chat_conversation_members;
create policy "conv-members: self leave"
  on public.chat_conversation_members for delete
  using (user_id = auth.uid());
