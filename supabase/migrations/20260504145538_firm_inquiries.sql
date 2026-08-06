-- Recovered 20260504145538 (firm_inquiries) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

create table if not exists public.firm_inquiries (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (length(trim(full_name)) between 1 and 200),
  work_email text not null check (length(trim(work_email)) between 3 and 320),
  firm_name text check (length(coalesce(firm_name, '')) <= 200),
  role_title text check (length(coalesce(role_title, '')) <= 200),
  phone text check (length(coalesce(phone, '')) <= 50),
  audience text not null
    check (audience in ('firm', 'individual', 'small_business')),
  client_count_band text
    check (client_count_band is null or client_count_band in (
      '1_solo', '2_10', '11_50', '51_200', '200_plus'
    )),
  current_software text
    check (length(coalesce(current_software, '')) <= 80),
  preferred_timing text
    check (preferred_timing is null or preferred_timing in (
      'this_week', 'next_week', 'this_month', 'exploring'
    )),
  notes text check (length(coalesce(notes, '')) <= 4000),
  source_path text check (length(coalesce(source_path, '')) <= 200),
  user_agent text check (length(coalesce(user_agent, '')) <= 500),
  status text not null default 'new'
    check (status in ('new', 'contacted', 'in_progress', 'won', 'lost', 'spam')),
  contacted_at timestamptz,
  contacted_by uuid references auth.users(id) on delete set null,
  notes_internal text check (length(coalesce(notes_internal, '')) <= 4000),
  created_at timestamptz not null default now()
);

create index if not exists firm_inquiries_status_idx
  on public.firm_inquiries (status, created_at desc);
create index if not exists firm_inquiries_email_idx
  on public.firm_inquiries (lower(work_email));

alter table public.firm_inquiries enable row level security;

drop policy if exists firm_inquiries_public_insert on public.firm_inquiries;
create policy firm_inquiries_public_insert
  on public.firm_inquiries
  for insert
  to anon, authenticated
  with check (true);
