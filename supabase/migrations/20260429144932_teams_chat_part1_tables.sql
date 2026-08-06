-- Recovered 20260429144932 (teams_chat_part1_tables) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Conversation tables. Avoid the gist-exclude constraint here (would need
-- btree_gist) and use a partial unique index instead.

do $$ begin
  create type public.conversation_kind as enum ('channel', 'group', 'dm');
exception when duplicate_object then null; end $$;

create table if not exists public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind public.conversation_kind not null,
  name text,
  is_default boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Channels and groups have a name; DMs derive their label from the
-- two participants. We don't enforce uniqueness per company.
alter table public.chat_conversations
  drop constraint if exists chat_conversations_name_shape;
alter table public.chat_conversations
  add constraint chat_conversations_name_shape
  check (
    (kind = 'dm' and name is null) or
    (kind <> 'dm' and name is not null and char_length(name) between 1 and 80)
  );

-- Only one default channel per company.
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
