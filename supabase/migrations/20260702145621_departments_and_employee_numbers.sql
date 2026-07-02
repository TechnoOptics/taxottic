-- Departments + auto-generated employee numbers.
--
-- Flat departments (no sub-department nesting for v1 — a company can have
-- "Sales", "Engineering", etc., but not nested trees). Every company_members
-- row gets a sequential, per-company employee_number the first time it's
-- inserted, regardless of which of the three code paths creates it
-- (handle_new_user's auto-accept, accept_invitation() RPC, or a future
-- direct manager-add path) — the numbering lives in ONE trigger so those
-- paths can never drift out of sync with each other.

-- ----------------------------------------------------------------------------
-- departments
-- ----------------------------------------------------------------------------
create table if not exists public.departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists departments_company_name_idx
  on public.departments (company_id, lower(name));

alter table public.company_members
  add column if not exists department_id uuid references public.departments(id) on delete set null,
  add column if not exists employee_number integer;

alter table public.invitations
  add column if not exists department_id uuid references public.departments(id) on delete set null;

-- ----------------------------------------------------------------------------
-- Auto-assign employee_number on insert, scoped per company. Only fires
-- when the caller didn't already supply one, so backfills/manual fixes
-- stay possible.
-- ----------------------------------------------------------------------------
create or replace function public.assign_employee_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.employee_number is null then
    select coalesce(max(employee_number), 0) + 1
      into new.employee_number
      from public.company_members
      where company_id = new.company_id;
  end if;
  return new;
end;
$$;

drop trigger if exists company_members_assign_employee_number on public.company_members;
create trigger company_members_assign_employee_number
  before insert on public.company_members
  for each row execute function public.assign_employee_number();

-- ----------------------------------------------------------------------------
-- RLS on departments — mirrors business_profiles: any company member can
-- read, only managers can write.
-- ----------------------------------------------------------------------------
alter table public.departments enable row level security;

drop policy if exists "departments: member read" on public.departments;
create policy "departments: member read"
  on public.departments for select
  using (public.is_company_member(company_id) or public.is_super_admin());

drop policy if exists "departments: manager insert" on public.departments;
create policy "departments: manager insert"
  on public.departments for insert
  with check (public.is_company_manager(company_id));

drop policy if exists "departments: manager update" on public.departments;
create policy "departments: manager update"
  on public.departments for update
  using (public.is_company_manager(company_id) or public.is_super_admin())
  with check (public.is_company_manager(company_id) or public.is_super_admin());

drop policy if exists "departments: manager delete" on public.departments;
create policy "departments: manager delete"
  on public.departments for delete
  using (public.is_company_manager(company_id) or public.is_super_admin());

-- ----------------------------------------------------------------------------
-- Carry department_id from an invitation onto the resulting membership row.
-- Recreates handle_new_user (last defined in 20260505000005_signup_trial.sql)
-- and accept_invitation (last defined in
-- 20260428000021_invitation_rpcs_with_personal_details.sql), adding
-- department_id alongside the existing title copy in both.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  invite_full_name text;
begin
  select i.full_name into invite_full_name
  from public.invitations i
  where lower(i.email) = lower(new.email)
    and i.accepted_at is null
    and i.expires_at > now()
    and i.full_name is not null
    and i.full_name <> ''
  order by i.created_at desc
  limit 1;

  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(invite_full_name, new.raw_user_meta_data->>'full_name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    updated_at = now();

  for inv in
    select * from public.invitations
    where lower(email) = lower(new.email)
      and accepted_at is null
      and expires_at > now()
  loop
    insert into public.company_members (company_id, user_id, role, title, department_id)
    values (inv.company_id, new.id, inv.role, inv.title, inv.department_id)
    on conflict (company_id, user_id) do update
      set title = coalesce(public.company_members.title, excluded.title),
          department_id = coalesce(public.company_members.department_id, excluded.department_id);

    update public.invitations
    set accepted_at = now(), accepted_by = new.id
    where id = inv.id;
  end loop;

  insert into public.subscriptions (
    user_id, plan, status, trial_end, last_credit_grant_at
  )
  values (
    new.id, 'solo', 'trialing', now() + interval '7 days', now()
  )
  on conflict (user_id) do nothing;

  insert into public.credits_ledger (user_id, delta_credits, reason, ref_id)
  values (new.id, 400, 'trial_grant', 'signup');

  return new;
end;
$$;

create or replace function public.accept_invitation(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.invitations%rowtype;
  user_email text;
  comp_public_id text;
begin
  if auth.uid() is null then
    raise exception 'auth_required';
  end if;

  select email into user_email from auth.users where id = auth.uid();

  select * into inv from public.invitations
  where token = p_token
    and accepted_at is null
    and expires_at > now()
  limit 1;

  if not found then
    raise exception 'invitation_invalid';
  end if;

  if lower(inv.email) <> lower(user_email) then
    raise exception 'email_mismatch';
  end if;

  insert into public.company_members (company_id, user_id, role, title, department_id)
  values (inv.company_id, auth.uid(), inv.role, inv.title, inv.department_id)
  on conflict (company_id, user_id) do update
    set title = coalesce(public.company_members.title, excluded.title),
        department_id = coalesce(public.company_members.department_id, excluded.department_id);

  if inv.full_name is not null and inv.full_name <> '' then
    update public.profiles
    set full_name = inv.full_name
    where id = auth.uid()
      and (full_name is null or full_name = '');
  end if;

  update public.invitations
  set accepted_at = now(), accepted_by = auth.uid()
  where id = inv.id;

  select public_id into comp_public_id
  from public.companies where id = inv.company_id;

  return comp_public_id;
end;
$$;

-- lookup_invitation: add department_name to the returned row so the
-- invite-acceptance page can show it. DROP required — OUT-row type changed.
drop function if exists public.lookup_invitation(text);

create or replace function public.lookup_invitation(p_token text)
returns table (
  company_name text,
  company_public_id text,
  role public.company_role,
  invitee_email text,
  invitee_full_name text,
  invitee_title text,
  personal_message text,
  department_name text,
  expires_at timestamptz,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.name,
    c.public_id,
    i.role,
    i.email,
    i.full_name,
    i.title,
    i.personal_message,
    d.name,
    i.expires_at,
    i.accepted_at
  from public.invitations i
  join public.companies c on c.id = i.company_id
  left join public.departments d on d.id = i.department_id
  where i.token = p_token
  limit 1;
$$;

grant execute on function public.lookup_invitation(text) to anon, authenticated;
grant execute on function public.accept_invitation(text) to authenticated;
