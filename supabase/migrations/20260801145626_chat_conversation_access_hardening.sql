-- Recovered 20260801145626 (chat_conversation_access_hardening) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Hole A: company membership now gates EVERY conversation kind.
-- Previously only the 'channel' branch checked company_members, so a
-- former employee kept reading private groups and DMs indefinitely.
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
    join public.company_members cm
      on cm.company_id = c.company_id
     and cm.user_id = auth.uid()
    where c.id = p_conversation_id
      and (
        c.kind = 'channel'
        or exists (
          select 1 from public.chat_conversation_members ccm
          where ccm.conversation_id = c.id
            and ccm.user_id = auth.uid()
        )
      )
  );
$$;

grant execute on function public.can_access_conversation(uuid) to authenticated;

-- Hole C: a DM can never gain a third participant. Only groups accept
-- new members from the client, only from someone already in the group,
-- and only for someone still in the company. The created_by escape
-- hatch is removed.
drop policy if exists "conv-members: insert by member"
  on public.chat_conversation_members;

create policy "conv-members: group member adds company member"
  on public.chat_conversation_members for insert
  with check (
    exists (
      select 1
      from public.chat_conversations c
      join public.company_members cm
        on cm.company_id = c.company_id
       and cm.user_id = chat_conversation_members.user_id
      where c.id = chat_conversation_members.conversation_id
        and c.kind = 'group'
    )
    and public.can_access_conversation(conversation_id)
  );

-- Removal: leave anything, or be removed from a GROUP by its creator or
-- a company manager. DMs stay untouchable by the other party.
drop policy if exists "conv-members: self leave"
  on public.chat_conversation_members;

create policy "conv-members: leave or be removed"
  on public.chat_conversation_members for delete
  using (
    user_id = auth.uid()
    or exists (
      select 1
      from public.chat_conversations c
      join public.company_members cm
        on cm.company_id = c.company_id
       and cm.user_id = auth.uid()
      where c.id = chat_conversation_members.conversation_id
        and c.kind = 'group'
        and (c.created_by = auth.uid() or cm.role = 'manager')
    )
  );

-- Make the data agree with the policy: clear chat memberships when the
-- company seat goes, so a departed person stops appearing in member lists.
create or replace function public.handle_company_member_removed_clear_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.chat_conversation_members ccm
  using public.chat_conversations c
  where ccm.conversation_id = c.id
    and c.company_id = old.company_id
    and ccm.user_id = old.user_id;
  return old;
end;
$$;

drop trigger if exists on_company_member_removed_clear_chat
  on public.company_members;
create trigger on_company_member_removed_clear_chat
  after delete on public.company_members
  for each row execute function public.handle_company_member_removed_clear_chat();

-- Backfill anyone already orphaned by a past removal. Counted against
-- production before applying: 0 rows.
delete from public.chat_conversation_members ccm
using public.chat_conversations c
where ccm.conversation_id = c.id
  and not exists (
    select 1 from public.company_members cm
    where cm.company_id = c.company_id
      and cm.user_id = ccm.user_id
  );

-- Inbox support: per-user read marker. Drives one dot on the chat list
-- and nothing else. No rail badge, no push, no outstanding-tasks entry.
create table if not exists public.chat_conversation_reads (
  conversation_id uuid not null
    references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists chat_conversation_reads_user_idx
  on public.chat_conversation_reads (user_id);

alter table public.chat_conversation_reads enable row level security;

drop policy if exists "conv-reads: own row" on public.chat_conversation_reads;
create policy "conv-reads: own row"
  on public.chat_conversation_reads for all
  using (user_id = auth.uid() and public.can_access_conversation(conversation_id))
  with check (user_id = auth.uid() and public.can_access_conversation(conversation_id));
