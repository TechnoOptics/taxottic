-- Recovered 20260515005252 (tier2_schemas) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- ============================================================================
-- 1. firm_invoice_templates — recurring invoice definitions
-- ============================================================================
do $$ begin
  create type public.firm_invoice_cadence as enum ('monthly','quarterly','annual');
exception when duplicate_object then null; end $$;

create table if not exists public.firm_invoice_templates (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  engagement_id uuid references public.firm_engagements(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  name text not null,
  line_items jsonb not null default '[]'::jsonb,
  currency text not null default 'usd',
  cadence public.firm_invoice_cadence not null default 'monthly',
  issue_day_of_month int check (issue_day_of_month between 1 and 28),
  active boolean not null default true,
  last_issued_at timestamptz,
  next_issue_at timestamptz,
  recipient_email text not null,
  recipient_name text,
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists firm_invoice_templates_firm_idx on public.firm_invoice_templates (firm_id, active);
create index if not exists firm_invoice_templates_next_idx on public.firm_invoice_templates (next_issue_at) where active = true;

alter table public.firm_invoice_templates enable row level security;

drop policy if exists "firm admins manage invoice templates" on public.firm_invoice_templates;
create policy "firm admins manage invoice templates" on public.firm_invoice_templates for all
  using (public.is_firm_owner_or_manager(firm_id)) with check (public.is_firm_owner_or_manager(firm_id));

create or replace function public.firm_invoice_templates_touch_updated_at()
returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end;
$fn$;
drop trigger if exists firm_invoice_templates_touch on public.firm_invoice_templates;
create trigger firm_invoice_templates_touch before update on public.firm_invoice_templates
  for each row execute function public.firm_invoice_templates_touch_updated_at();

-- ============================================================================
-- 2. firm_threads + firm_messages — firm-internal messaging
-- ============================================================================
create table if not exists public.firm_threads (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  engagement_id uuid references public.firm_engagements(id) on delete set null,
  title text not null,
  created_by uuid references public.profiles(id) on delete set null,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  last_message_at timestamptz default now()
);

create index if not exists firm_threads_firm_idx on public.firm_threads (firm_id, last_message_at desc) where archived_at is null;
create index if not exists firm_threads_engagement_idx on public.firm_threads (engagement_id, last_message_at desc) where engagement_id is not null and archived_at is null;

alter table public.firm_threads enable row level security;

drop policy if exists "firm members read threads" on public.firm_threads;
create policy "firm members read threads" on public.firm_threads for select
  using (public.is_firm_member(firm_id) or public.is_super_admin());

drop policy if exists "firm members write threads" on public.firm_threads;
create policy "firm members write threads" on public.firm_threads for insert
  with check (public.is_firm_member(firm_id));

drop policy if exists "firm members update own threads" on public.firm_threads;
create policy "firm members update own threads" on public.firm_threads for update
  using (created_by = auth.uid() or public.is_firm_owner_or_manager(firm_id));

create table if not exists public.firm_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.firm_threads(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 8000),
  attachments jsonb not null default '[]'::jsonb,
  mentions uuid[] not null default '{}',
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists firm_messages_thread_idx on public.firm_messages (thread_id, created_at);

alter table public.firm_messages enable row level security;

drop policy if exists "firm members read messages" on public.firm_messages;
create policy "firm members read messages" on public.firm_messages for select
  using (public.is_firm_member(firm_id) or public.is_super_admin());

drop policy if exists "firm members write messages" on public.firm_messages;
create policy "firm members write messages" on public.firm_messages for insert
  with check (public.is_firm_member(firm_id) and author_id = auth.uid());

drop policy if exists "author can edit own messages" on public.firm_messages;
create policy "author can edit own messages" on public.firm_messages for update
  using (author_id = auth.uid());

create or replace function public.firm_messages_touch_thread()
returns trigger language plpgsql as $fn$
begin
  update public.firm_threads set last_message_at = new.created_at where id = new.thread_id;
  return new;
end;
$fn$;
drop trigger if exists firm_messages_touch_thread on public.firm_messages;
create trigger firm_messages_touch_thread after insert on public.firm_messages
  for each row execute function public.firm_messages_touch_thread();

do $$ begin alter publication supabase_realtime add table public.firm_messages; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table public.firm_threads; exception when others then null; end $$;

-- ============================================================================
-- 3. firm_document_comments — annotations on documents
-- ============================================================================
create table if not exists public.firm_document_comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.firm_documents(id) on delete cascade,
  firm_id uuid not null references public.firms(id) on delete cascade,
  author_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  page_number int,
  anchor_bbox jsonb,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists firm_document_comments_doc_idx on public.firm_document_comments (document_id, created_at);
create index if not exists firm_document_comments_open_idx on public.firm_document_comments (firm_id, document_id) where resolved_at is null;

alter table public.firm_document_comments enable row level security;

drop policy if exists "firm members read doc comments" on public.firm_document_comments;
create policy "firm members read doc comments" on public.firm_document_comments for select
  using (public.is_firm_member(firm_id) or public.is_super_admin());

drop policy if exists "firm members write doc comments" on public.firm_document_comments;
create policy "firm members write doc comments" on public.firm_document_comments for insert
  with check (public.is_firm_member(firm_id) and author_id = auth.uid());

drop policy if exists "author or admin edits doc comments" on public.firm_document_comments;
create policy "author or admin edits doc comments" on public.firm_document_comments for update
  using (author_id = auth.uid() or public.is_firm_owner_or_manager(firm_id));

do $$ begin alter publication supabase_realtime add table public.firm_document_comments; exception when others then null; end $$;
