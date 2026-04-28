-- Taxottic Phase 1: tenancy + super-admin schema
-- Tables: profiles, companies, company_members, invitations, super_admins
-- All user-facing identifiers use public IDs (tax_*, co_*) so internal UUIDs never leak.

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Public ID generator (base36, prefixed)
-- ----------------------------------------------------------------------------
create or replace function public.generate_public_id(prefix text, len int default 10)
returns text
language plpgsql
as $$
declare
  alphabet text := '0123456789abcdefghijklmnopqrstuvwxyz';
  out text := '';
  i int;
begin
  for i in 1..len loop
    out := out || substr(alphabet, 1 + (floor(random() * length(alphabet)))::int, 1);
  end loop;
  return prefix || '_' || out;
end;
$$;

-- ----------------------------------------------------------------------------
-- profiles: one row per auth.users entry
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  public_id text not null unique default public.generate_public_id('tax'),
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_email_idx on public.profiles (lower(email));

-- ----------------------------------------------------------------------------
-- companies
-- ----------------------------------------------------------------------------
create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique default public.generate_public_id('co'),
  name text not null,
  entity_type text,
  state_code text,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- company_members: membership + role
-- ----------------------------------------------------------------------------
create type public.company_role as enum ('manager', 'member');

create table if not exists public.company_members (
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.company_role not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create index if not exists company_members_user_idx on public.company_members (user_id);

-- ----------------------------------------------------------------------------
-- invitations: pending email invites issued by a manager
-- ----------------------------------------------------------------------------
create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role public.company_role not null default 'member',
  token text not null unique,
  invited_by uuid not null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);

create index if not exists invitations_email_idx on public.invitations (lower(email));
create index if not exists invitations_company_idx on public.invitations (company_id);

-- ----------------------------------------------------------------------------
-- super_admins: forever allowlist by email (cannot be removed by app code)
-- Only the postgres role can mutate this table; even service-role inserts are
-- restricted to bootstrap entries. Two seed addresses below.
-- ----------------------------------------------------------------------------
create table if not exists public.super_admins (
  email text primary key,
  added_at timestamptz not null default now()
);

insert into public.super_admins (email) values
  ('contact@taxottic.com'),
  ('contact@technooptics.com')
on conflict (email) do nothing;

-- ----------------------------------------------------------------------------
-- Helper: is current user a super admin?
-- ----------------------------------------------------------------------------
create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.super_admins sa
    join auth.users u on lower(u.email) = lower(sa.email)
    where u.id = auth.uid()
  );
$$;

-- ----------------------------------------------------------------------------
-- Helper: is user a manager of company?
-- ----------------------------------------------------------------------------
create or replace function public.is_company_manager(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_members
    where company_id = p_company
      and user_id = auth.uid()
      and role = 'manager'
  );
$$;

-- ----------------------------------------------------------------------------
-- Helper: is user a member of company?
-- ----------------------------------------------------------------------------
create or replace function public.is_company_member(p_company uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_members
    where company_id = p_company and user_id = auth.uid()
  );
$$;

-- ----------------------------------------------------------------------------
-- Auto-create profile + auto-link pending invitations on signup
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();

  -- Auto-accept any pending invitations for this email.
  for inv in
    select * from public.invitations
    where lower(email) = lower(new.email)
      and accepted_at is null
      and expires_at > now()
  loop
    insert into public.company_members (company_id, user_id, role)
    values (inv.company_id, new.id, inv.role)
    on conflict do nothing;

    update public.invitations
    set accepted_at = now(), accepted_by = new.id
    where id = inv.id;
  end loop;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists companies_touch on public.companies;
create trigger companies_touch before update on public.companies
  for each row execute function public.touch_updated_at();
