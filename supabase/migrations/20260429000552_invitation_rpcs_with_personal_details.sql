-- Recovered 20260429000552 (invitation_rpcs_with_personal_details) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

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
    i.expires_at,
    i.accepted_at
  from public.invitations i
  join public.companies c on c.id = i.company_id
  where i.token = p_token
  limit 1;
$$;

grant execute on function public.lookup_invitation(text) to anon, authenticated;

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

  -- Add membership and seed the manager-supplied job title.
  insert into public.company_members (company_id, user_id, role, title)
  values (inv.company_id, auth.uid(), inv.role, inv.title)
  on conflict (company_id, user_id) do update
    set title = coalesce(public.company_members.title, excluded.title);

  -- Copy the invitee's name onto their profile if they haven't filled it
  -- in themselves yet. Profiles use full_name; only overwrite when null.
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

grant execute on function public.accept_invitation(text) to authenticated;
