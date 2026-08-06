-- Recovered 20260428145741 (phase3_bella_kb) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create extension if not exists vector;
create extension if not exists pg_trgm;

-- Knowledge base documents (e.g. IRS Pub 535).
create table if not exists public.tax_kb_documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  doc_type text not null,           -- 'irs_pub' | 'irs_form_inst' | 'curated' | etc.
  source_url text,
  publication_year int,
  created_at timestamptz not null default now()
);

-- Chunks of those documents with optional embedding.
-- Embedding dim 1024 matches Voyage 3 large; nullable for keyword-only fallback.
create table if not exists public.tax_kb_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.tax_kb_documents(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  embedding vector(1024),
  tokens int,
  created_at timestamptz not null default now()
);
create index if not exists tax_kb_chunks_doc_idx on public.tax_kb_chunks (document_id);
create index if not exists tax_kb_chunks_content_trgm on public.tax_kb_chunks using gin (content gin_trgm_ops);

-- HNSW index for vector similarity (built on demand once embeddings are present)
do $$ begin
  if not exists (
    select 1 from pg_indexes where indexname = 'tax_kb_chunks_embedding_hnsw'
  ) then
    create index tax_kb_chunks_embedding_hnsw
      on public.tax_kb_chunks
      using hnsw (embedding vector_cosine_ops);
  end if;
end $$;

-- Bella conversations + messages.
create table if not exists public.bella_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bella_conversations_user_idx on public.bella_conversations (user_id, updated_at desc);

do $$ begin
  create type public.bella_role as enum ('user', 'assistant', 'system');
exception when duplicate_object then null;
end $$;

create table if not exists public.bella_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.bella_conversations(id) on delete cascade,
  role public.bella_role not null,
  content text not null,
  citations jsonb,                 -- [{document_id, chunk_index, snippet, source_url, title}]
  created_at timestamptz not null default now()
);
create index if not exists bella_messages_convo_idx on public.bella_messages (conversation_id, created_at);

drop trigger if exists bella_conversations_touch on public.bella_conversations;
create trigger bella_conversations_touch before update on public.bella_conversations
  for each row execute function public.touch_updated_at();

-- RLS
alter table public.tax_kb_documents enable row level security;
alter table public.tax_kb_chunks enable row level security;
alter table public.bella_conversations enable row level security;
alter table public.bella_messages enable row level security;

-- KB is public-read for any signed-in user.
drop policy if exists "kb_documents: read all" on public.tax_kb_documents;
create policy "kb_documents: read all"
  on public.tax_kb_documents for select
  using (auth.uid() is not null);

drop policy if exists "kb_chunks: read all" on public.tax_kb_chunks;
create policy "kb_chunks: read all"
  on public.tax_kb_chunks for select
  using (auth.uid() is not null);

-- Conversations and messages: own rows only (super-admin read all).
drop policy if exists "bella_conversations: own read" on public.bella_conversations;
create policy "bella_conversations: own read"
  on public.bella_conversations for select
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "bella_conversations: own insert" on public.bella_conversations;
create policy "bella_conversations: own insert"
  on public.bella_conversations for insert
  with check (user_id = auth.uid());

drop policy if exists "bella_conversations: own update" on public.bella_conversations;
create policy "bella_conversations: own update"
  on public.bella_conversations for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "bella_conversations: own delete" on public.bella_conversations;
create policy "bella_conversations: own delete"
  on public.bella_conversations for delete
  using (user_id = auth.uid());

drop policy if exists "bella_messages: own read" on public.bella_messages;
create policy "bella_messages: own read"
  on public.bella_messages for select
  using (
    exists (
      select 1 from public.bella_conversations c
      where c.id = bella_messages.conversation_id
        and (c.user_id = auth.uid() or public.is_super_admin())
    )
  );

drop policy if exists "bella_messages: own insert" on public.bella_messages;
create policy "bella_messages: own insert"
  on public.bella_messages for insert
  with check (
    exists (
      select 1 from public.bella_conversations c
      where c.id = bella_messages.conversation_id
        and c.user_id = auth.uid()
    )
  );

-- Hybrid search RPC: trigram similarity now, vector cosine when embeddings exist.
create or replace function public.bella_kb_search(
  p_query text,
  p_limit int default 6
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_title text,
  source_url text,
  chunk_index int,
  content text,
  similarity float
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id as chunk_id,
    d.id as document_id,
    d.title as document_title,
    d.source_url,
    c.chunk_index,
    c.content,
    similarity(c.content, p_query) as similarity
  from public.tax_kb_chunks c
  join public.tax_kb_documents d on d.id = c.document_id
  where c.content % p_query
  order by similarity(c.content, p_query) desc
  limit greatest(1, least(p_limit, 25));
$$;

grant execute on function public.bella_kb_search(text, int) to authenticated;
