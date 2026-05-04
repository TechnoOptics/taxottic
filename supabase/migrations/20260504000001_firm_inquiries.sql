-- Public booking / migration inquiries.
--
-- Sales lead intake from the /book page. No auth required so visiting
-- firms can fill the form without creating an account; we store the
-- contact info, write a short "what they need" payload, and the team
-- follows up out-of-band (email / call).
--
-- RLS: anonymous insert, no anonymous select. Only the service role
-- (admin) can read inquiries via the HQ ops console.

create table if not exists public.firm_inquiries (
  id uuid primary key default gen_random_uuid(),
  -- Contact
  full_name text not null check (length(trim(full_name)) between 1 and 200),
  work_email text not null check (length(trim(work_email)) between 3 and 320),
  firm_name text check (length(coalesce(firm_name, '')) <= 200),
  role_title text check (length(coalesce(role_title, '')) <= 200),
  phone text check (length(coalesce(phone, '')) <= 50),
  -- Intent
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
  -- Provenance
  source_path text check (length(coalesce(source_path, '')) <= 200),
  user_agent text check (length(coalesce(user_agent, '')) <= 500),
  -- Lifecycle
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

-- Anonymous + authenticated public can INSERT. We rely on the column
-- length / enum checks for shape validation; the server action layers
-- on rate limiting before the insert runs.
drop policy if exists firm_inquiries_public_insert on public.firm_inquiries;
create policy firm_inquiries_public_insert
  on public.firm_inquiries
  for insert
  to anon, authenticated
  with check (true);

-- No public SELECT / UPDATE / DELETE. Only the service role bypasses
-- RLS to read / move inquiries via the HQ ops console.
