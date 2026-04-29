-- Microsoft Teams-style chat:
--   * Open "channels" (any company member can read/post)
--   * Private named "groups" (only listed members)
--   * One-on-one DMs (only the two members)
--   * File / media attachments via a per-company private storage bucket
--
-- Existing team_messages is extended with conversation_id and every
-- company gets an auto-seeded "General" channel. Prior history (if any)
-- is migrated onto the General channel so nothing is lost.

-- ---------- conversation kind ----------
do $$ begin
  create type public.conversation_kind as enum ('channel', 'group', 'dm');
exception when duplicate_object then null; end $$;

-- ---------- conversations ----------
create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind public.conversation_kind not null,
  name text,
  is_default boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.chat_conversations
  drop constraint if exists chat_conversations_name_shape;
alter table public.chat_conversations
  add constraint chat_conversations_name_shape
  check (
    (kind = 'dm' and name is null) or
    (kind <> 'dm' and name is not null and char_length(name) between 1 and 80)
  );

create unique index if not exists chat_conversations_one_default_per_company
  on public.chat_conversations (company_id) where is_default;

create index if not exists chat_conversations_company_idx
  on public.chat_conversations (company_id);

create table if not exists public.chat_conversation_members (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create index if not exists chat_conversation_members_user_idx
  on public.chat_conversation_members (user_id);

-- ---------- helper ----------
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

-- ---------- conversation RLS ----------
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

-- ---------- team_messages migration ----------
alter table public.team_messages
  add column if not exists conversation_id uuid references public.chat_conversations(id) on delete cascade;

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

-- ---------- attachments ----------
create table if not exists public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.team_messages(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes between 0 and 26214400),
  created_at timestamptz not null default now()
);

create index if not exists chat_attachments_message_idx
  on public.chat_attachments (message_id);

alter table public.chat_attachments enable row level security;

drop policy if exists "chat_attachments: visible with message" on public.chat_attachments;
create policy "chat_attachments: visible with message"
  on public.chat_attachments for select
  using (
    exists (
      select 1 from public.team_messages tm
      where tm.id = chat_attachments.message_id
        and public.can_access_conversation(tm.conversation_id)
    )
  );

drop policy if exists "chat_attachments: insert with own message" on public.chat_attachments;
create policy "chat_attachments: insert with own message"
  on public.chat_attachments for insert
  with check (
    exists (
      select 1 from public.team_messages tm
      where tm.id = chat_attachments.message_id
        and tm.user_id = auth.uid()
    )
  );

-- ---------- chat-attachments storage bucket + RLS ----------
insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

drop policy if exists "chat-attachments: read by conv member" on storage.objects;
create policy "chat-attachments: read by conv member"
  on storage.objects for select
  using (
    bucket_id = 'chat-attachments'
    and exists (
      select 1
      from public.companies c
      join public.chat_conversations cc on cc.company_id = c.id
      where c.public_id = (storage.foldername(storage.objects.name))[1]
        and cc.id::text = (storage.foldername(storage.objects.name))[2]
        and public.can_access_conversation(cc.id)
    )
  );

drop policy if exists "chat-attachments: insert by conv member" on storage.objects;
create policy "chat-attachments: insert by conv member"
  on storage.objects for insert
  with check (
    bucket_id = 'chat-attachments'
    and exists (
      select 1
      from public.companies c
      join public.chat_conversations cc on cc.company_id = c.id
      where c.public_id = (storage.foldername(storage.objects.name))[1]
        and cc.id::text = (storage.foldername(storage.objects.name))[2]
        and public.can_access_conversation(cc.id)
    )
  );

drop policy if exists "chat-attachments: own delete" on storage.objects;
create policy "chat-attachments: own delete"
  on storage.objects for delete
  using (
    bucket_id = 'chat-attachments'
    and owner = auth.uid()
  );

-- ---------- auto-seed General channel for new companies ----------
create or replace function public.handle_new_company_create_general_channel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.chat_conversations (company_id, kind, name, is_default, created_by)
  values (new.id, 'channel', 'General', true, new.created_by)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_company_created on public.companies;
create trigger on_company_created
  after insert on public.companies
  for each row execute function public.handle_new_company_create_general_channel();

-- ---------- realtime ----------
do $$ begin
  alter publication supabase_realtime add table public.chat_conversations;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.chat_conversation_members;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.chat_attachments;
exception when others then null; end $$;
