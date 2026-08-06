-- Recovered 20260428222134 (profiles_gdpr_block_feedback) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Profile additions: GDPR consent timestamp + admin block flag/reason.
alter table public.profiles
  add column if not exists gdpr_consented_at timestamptz,
  add column if not exists is_blocked boolean not null default false,
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_reason text;

-- Re-affirm forever-admin allowlist (idempotent).
insert into public.super_admins (email) values
  ('contact@taxottic.com'),
  ('contact@technooptics.com')
on conflict (email) do nothing;

-- Feedback: any signed-in user can submit; admins read all.
do $$ begin
  create type public.feedback_kind as enum ('crash', 'bug', 'idea', 'praise', 'other');
exception when duplicate_object then null;
end $$;

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  email text,                        -- snapshot at submission time
  kind public.feedback_kind not null default 'other',
  subject text,
  body text not null,
  page_url text,
  user_agent text,
  status text not null default 'new', -- new | seen | resolved | dismissed
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists feedback_status_idx on public.feedback (status, created_at desc);
create index if not exists feedback_user_idx on public.feedback (user_id, created_at desc);

drop trigger if exists feedback_touch on public.feedback;
create trigger feedback_touch before update on public.feedback
  for each row execute function public.touch_updated_at();

alter table public.feedback enable row level security;

-- Insert: any authenticated user (logged in or anon-as-public). For now,
-- only authenticated users can submit so we have audit trail.
drop policy if exists "feedback: own insert" on public.feedback;
create policy "feedback: own insert"
  on public.feedback for insert
  with check (
    auth.uid() is not null
    and (user_id is null or user_id = auth.uid())
  );

drop policy if exists "feedback: own read" on public.feedback;
create policy "feedback: own read"
  on public.feedback for select
  using (user_id = auth.uid() or public.is_super_admin());

drop policy if exists "feedback: super-admin update" on public.feedback;
create policy "feedback: super-admin update"
  on public.feedback for update
  using (public.is_super_admin())
  with check (public.is_super_admin());

drop policy if exists "feedback: super-admin delete" on public.feedback;
create policy "feedback: super-admin delete"
  on public.feedback for delete
  using (public.is_super_admin());

-- Admin actions audit (block/unblock, etc.)
create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  target_user_id uuid references auth.users(id) on delete set null,
  action text not null,             -- 'block_user' | 'unblock_user' | 'note'
  reason text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_actions_target_idx on public.admin_actions (target_user_id, created_at desc);

alter table public.admin_actions enable row level security;
drop policy if exists "admin_actions: super-admin read" on public.admin_actions;
create policy "admin_actions: super-admin read"
  on public.admin_actions for select
  using (public.is_super_admin());

-- Insert/update happen via service role only.;
