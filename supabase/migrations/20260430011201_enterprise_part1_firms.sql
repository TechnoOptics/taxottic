-- Recovered 20260430011201 (enterprise_part1_firms) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

do $$ begin
  create type public.firm_status as enum ('pending', 'active', 'suspended');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.firm_role as enum ('owner', 'manager', 'preparer', 'reviewer');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.firm_tier as enum ('starter', 'growth', 'firm', 'enterprise');
exception when duplicate_object then null; end $$;

create table if not exists public.firms (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default ('firm_' || lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))),
  name text not null check (length(name) between 1 and 120),
  legal_name text,
  ein text,
  logo_url text,
  accent_color text default '#0F2D24',
  address_line1 text,
  address_line2 text,
  city text,
  state_code text,
  zip text,
  phone text,
  email text,
  website text,
  status public.firm_status not null default 'pending',
  tier public.firm_tier not null default 'starter',
  client_seats_limit int not null default 25,
  preparer_seats_limit int not null default 3,
  notes text,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null
);

create index if not exists firms_status_idx on public.firms (status);

create table if not exists public.firm_members (
  firm_id uuid not null references public.firms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.firm_role not null default 'preparer',
  title text,
  joined_at timestamptz not null default now(),
  primary key (firm_id, user_id)
);

create index if not exists firm_members_user_idx on public.firm_members (user_id);

create table if not exists public.firm_invitations (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  email text not null,
  full_name text,
  title text,
  role public.firm_role not null default 'preparer',
  token text not null unique,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);

create index if not exists firm_invitations_email_idx
  on public.firm_invitations (lower(email));
create index if not exists firm_invitations_firm_idx
  on public.firm_invitations (firm_id);

create table if not exists public.firm_access_requests (
  id uuid primary key default gen_random_uuid(),
  firm_name text not null check (length(firm_name) between 1 and 120),
  contact_full_name text not null,
  contact_email text not null,
  contact_phone text,
  firm_size text,
  message text,
  source text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

create index if not exists firm_access_requests_status_idx
  on public.firm_access_requests (status, created_at desc);
