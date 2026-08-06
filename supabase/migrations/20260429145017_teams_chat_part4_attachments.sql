-- Recovered 20260429145017 (teams_chat_part4_attachments) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

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

insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;
