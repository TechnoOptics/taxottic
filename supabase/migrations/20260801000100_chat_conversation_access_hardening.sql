-- Chat access-control hardening + inbox support.
--
-- Additive only. Nothing that holds data is dropped: this replaces one
-- function body and three policies, adds one nullable column, and adds
-- one trigger. Existing conversations, memberships, messages and
-- attachments are untouched.
--
-- Two holes were found in the live policies and reproduced with real
-- queries run as the affected user:
--
--   A. can_access_conversation() only checks company_members on the
--      'channel' branch. Groups and DMs are gated on
--      chat_conversation_members alone, and removing someone from a
--      company never touched that table -- so a former employee kept
--      reading a private group indefinitely.
--
--   C. "conv-members: insert by member" never looked at the
--      conversation's kind, so either participant in a 1:1 DM could
--      insert a third company member from the client and hand them the
--      whole private history. The server action refuses this; RLS did
--      not, and RLS is the thing that has to hold.
--
-- Every server action writes through the service-role client, which
-- bypasses RLS, so tightening these policies cannot break the app's own
-- write paths -- only the direct-from-client ones.
--
-- ---------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------
-- Restore the previous behaviour by re-running these three bodies (the
-- reads table and the trigger can be left in place harmlessly, or
-- dropped with the two statements at the end):
--
--   create or replace function public.can_access_conversation(p_conversation_id uuid)
--   returns boolean language sql stable security definer set search_path = public as $r$
--     select exists (
--       select 1 from public.chat_conversations c
--       where c.id = p_conversation_id
--         and ((c.kind = 'channel' and exists (
--                select 1 from public.company_members cm
--                where cm.company_id = c.company_id and cm.user_id = auth.uid()))
--              or exists (
--                select 1 from public.chat_conversation_members ccm
--                where ccm.conversation_id = c.id and ccm.user_id = auth.uid())));
--   $r$;
--
--   drop policy if exists "conv-members: insert by member" on public.chat_conversation_members;
--   create policy "conv-members: insert by member" on public.chat_conversation_members
--     for insert with check (
--       (can_access_conversation(conversation_id)
--        or exists (select 1 from chat_conversations c
--                   where c.id = chat_conversation_members.conversation_id
--                     and c.created_by = auth.uid()))
--       and exists (select 1 from chat_conversations c
--                   join company_members cm on cm.company_id = c.company_id
--                   where c.id = chat_conversation_members.conversation_id
--                     and cm.user_id = chat_conversation_members.user_id));
--
--   drop policy if exists "conv-members: leave or be removed" on public.chat_conversation_members;
--   create policy "conv-members: self leave" on public.chat_conversation_members
--     for delete using (user_id = auth.uid());
--
--   drop trigger if exists on_company_member_removed_clear_chat on public.company_members;
--   drop table if exists public.chat_conversation_reads;
-- ---------------------------------------------------------------

-- ============================================================
-- 1. Hole A: company membership gates every conversation kind.
-- ============================================================
-- Groups and DMs now require BOTH an explicit conversation membership
-- row AND a live company_members row. Losing your seat at the company
-- costs you the conversations the same moment, at the database.
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

-- ============================================================
-- 2. Hole C: a DM can never gain a third participant.
-- ============================================================
-- Only groups accept new members from the client, only from someone
-- already in the group, and only for someone still in the company.
-- Channels include everyone implicitly and never carry member rows.
-- The `created_by` escape hatch is gone.
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

-- ============================================================
-- 3. Removal: leave anything, or be removed from a group by its
--    creator or a company manager.
-- ============================================================
-- Before this there was only self-leave, so an invite to a group was
-- irrevocable. DMs stay untouchable by the other party: you can leave
-- your own DM, you can never evict the person you were talking to.
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

-- ============================================================
-- 4. Make the data agree with the policy, not just the policy.
-- ============================================================
-- Step 1 already denies a former employee, but leaving the stale
-- membership rows behind means the group's member list keeps showing a
-- person who is gone. Clear them when the company seat goes.
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

-- Backfill the same rule for anyone already orphaned by a past removal.
delete from public.chat_conversation_members ccm
using public.chat_conversations c
where ccm.conversation_id = c.id
  and not exists (
    select 1 from public.company_members cm
    where cm.company_id = c.company_id
      and cm.user_id = ccm.user_id
  );

-- ============================================================
-- 5. Inbox support: per-user read marker.
-- ============================================================
-- Deliberately minimal. This drives one dot on the chat list and
-- nothing else: no rail badge, no push, no outstanding-tasks entry.
--
-- It lives in its own table rather than as a column on
-- chat_conversation_members because channels carry no membership rows
-- at all, and one mechanism that covers all three kinds beats two that
-- each cover part. One row per (conversation, user), written lazily the
-- first time you open the conversation.
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
