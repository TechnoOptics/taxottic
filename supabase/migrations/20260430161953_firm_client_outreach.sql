-- Recovered 20260430161953 (firm_client_outreach) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Pre-signup invitation pipeline. A firm uploads a CSV of clients
-- they want to engage; some of those clients are already Taxottic
-- users (we can immediately create a firm_engagement against their
-- existing company), but most won't be yet. For those, we land a row
-- in firm_client_outreach so when the email signs up + creates a
-- company on the customer side, we surface a "your firm wants to
-- engage you" prompt that converts the outreach into a real
-- firm_engagement.

create table if not exists public.firm_client_outreach (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms(id) on delete cascade,
  email text not null,
  full_name text,
  business_name text,
  tax_year int not null,
  kind public.engagement_kind not null default 'tax_prep',
  message text,
  invited_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'converted', 'declined', 'expired')),
  -- After conversion, we link to the resulting engagement so the
  -- firm side can see "this prospect became a real engagement".
  converted_engagement_id uuid references public.firm_engagements(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 days'),
  responded_at timestamptz
);

create index if not exists firm_client_outreach_firm_idx
  on public.firm_client_outreach (firm_id, status, created_at desc);
create index if not exists firm_client_outreach_email_idx
  on public.firm_client_outreach (lower(email), status);

alter table public.firm_client_outreach enable row level security;

-- Firm members read their firm's outreach list.
drop policy if exists "fco: firm member read" on public.firm_client_outreach;
create policy "fco: firm member read"
  on public.firm_client_outreach for select
  using (public.is_firm_member(firm_id) or public.is_super_admin());

drop policy if exists "fco: firm manager insert" on public.firm_client_outreach;
create policy "fco: firm manager insert"
  on public.firm_client_outreach for insert
  with check (public.is_firm_owner_or_manager(firm_id));

-- Updates: firm side can change status (e.g., decline / cancel) AND
-- the customer side can mark converted/declined when they respond.
-- We allow update by either the firm or anyone whose email matches
-- the outreach row; the auth.uid() -> auth.users -> email join is
-- the standard way.
drop policy if exists "fco: firm or invitee update" on public.firm_client_outreach;
create policy "fco: firm or invitee update"
  on public.firm_client_outreach for update
  using (
    public.is_firm_owner_or_manager(firm_id)
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- Helper: pending outreach for the current user's email. Used by the
-- customer-app dashboard to surface "Joe Smith CPA wants to engage
-- you" prompts. SECURITY DEFINER so we can read across the table
-- without polluting the SELECT policy with a "match my email" branch.
create or replace function public.pending_firm_outreach_for_me()
returns table (
  id uuid,
  firm_id uuid,
  firm_name text,
  firm_public_id text,
  firm_logo_url text,
  full_name text,
  business_name text,
  tax_year int,
  kind public.engagement_kind,
  message text,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id,
    o.firm_id,
    f.name,
    f.public_id,
    f.logo_url,
    o.full_name,
    o.business_name,
    o.tax_year,
    o.kind,
    o.message,
    o.created_at,
    o.expires_at
  from public.firm_client_outreach o
  join public.firms f on f.id = o.firm_id
  where o.status = 'pending'
    and o.expires_at > now()
    and lower(o.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  order by o.created_at desc;
$$;

grant execute on function public.pending_firm_outreach_for_me() to authenticated;

-- RPC to convert an outreach into a real engagement once the customer
-- has chosen which company on their account to attach. SECURITY
-- DEFINER + email match guard so we can write into firm_engagements
-- without the customer needing direct insert privilege on it from
-- the engagements RLS path.
create or replace function public.convert_firm_outreach(
  p_outreach_id uuid,
  p_company_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.firm_client_outreach%rowtype;
  user_email text;
  user_id_v uuid;
  caller_role public.company_role;
  new_engagement_id uuid;
begin
  user_id_v := auth.uid();
  if user_id_v is null then
    raise exception 'auth_required';
  end if;

  select email into user_email from auth.users where id = user_id_v;

  select * into o
  from public.firm_client_outreach
  where id = p_outreach_id
    and status = 'pending'
    and expires_at > now()
  limit 1;
  if not found then
    raise exception 'outreach_invalid';
  end if;
  if lower(o.email) <> lower(user_email) then
    raise exception 'email_mismatch';
  end if;

  -- Caller must be a manager of the company they're attaching.
  select role into caller_role
  from public.company_members
  where user_id = user_id_v
    and company_id = p_company_id
  limit 1;
  if caller_role is null or caller_role <> 'manager' then
    raise exception 'manager_only';
  end if;

  -- Create the engagement directly into 'active' status: both sides
  -- have already opted in (the firm sent the outreach, the customer
  -- accepted it by calling this RPC). The unique (firm, company,
  -- year, kind) constraint blocks duplicates.
  insert into public.firm_engagements (
    firm_id, company_id, tax_year, kind, status,
    requested_by, requested_by_side, responded_at, responded_by,
    client_note
  )
  values (
    o.firm_id, p_company_id, o.tax_year, o.kind, 'active',
    user_id_v, 'client', now(), user_id_v,
    o.message
  )
  on conflict (firm_id, company_id, tax_year, kind) do update
    set status = 'active', responded_at = now(), responded_by = user_id_v
  returning id into new_engagement_id;

  update public.firm_client_outreach
  set status = 'converted',
      responded_at = now(),
      converted_engagement_id = new_engagement_id
  where id = p_outreach_id;

  return new_engagement_id;
end;
$$;

grant execute on function public.convert_firm_outreach(uuid, uuid) to authenticated;

create or replace function public.decline_firm_outreach(p_outreach_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  o public.firm_client_outreach%rowtype;
  user_email text;
begin
  if auth.uid() is null then
    raise exception 'auth_required';
  end if;
  select email into user_email from auth.users where id = auth.uid();

  select * into o from public.firm_client_outreach
  where id = p_outreach_id and status = 'pending' limit 1;
  if not found then return false; end if;
  if lower(o.email) <> lower(user_email) then
    raise exception 'email_mismatch';
  end if;

  update public.firm_client_outreach
  set status = 'declined', responded_at = now()
  where id = p_outreach_id;
  return true;
end;
$$;

grant execute on function public.decline_firm_outreach(uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.firm_client_outreach;
exception when others then null; end $$;
