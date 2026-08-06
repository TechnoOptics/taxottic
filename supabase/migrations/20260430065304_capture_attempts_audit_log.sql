-- Recovered 20260430065304 (capture_attempts_audit_log) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Audit log for content-capture deterrents. The client-side
-- NoCapture component pings /api/capture-attempt whenever it
-- catches a heuristic (right-click on protected content, Ctrl+S,
-- Ctrl+P, PrintScreen, devtools open). We can't actually block
-- the OS-level capture, but we can record who tripped what and
-- when, which is real legal/forensic standing if a leak surfaces.

create table if not exists public.capture_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (
    kind in (
      'right_click',
      'save_shortcut',
      'print_shortcut',
      'print_screen',
      'devtools_open',
      'image_drag',
      'unauthorized_print'
    )
  ),
  path text,
  user_agent text,
  ip text,
  details jsonb,
  created_at timestamptz not null default now()
);

create index if not exists capture_attempts_user_idx
  on public.capture_attempts (user_id, created_at desc);
create index if not exists capture_attempts_kind_idx
  on public.capture_attempts (kind, created_at desc);

alter table public.capture_attempts enable row level security;

-- Authenticated users can insert their own log entries (the API
-- route validates user_id matches auth.uid() via service-role
-- before insert, but RLS gives us defense-in-depth).
drop policy if exists "capture_attempts: own insert" on public.capture_attempts;
create policy "capture_attempts: own insert"
  on public.capture_attempts for insert
  with check (user_id = auth.uid() or user_id is null);

-- Only super admins can read the log.
drop policy if exists "capture_attempts: super read" on public.capture_attempts;
create policy "capture_attempts: super read"
  on public.capture_attempts for select
  using (public.is_super_admin());
