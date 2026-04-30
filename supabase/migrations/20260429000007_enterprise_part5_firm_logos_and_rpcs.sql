-- Firm logo storage bucket + invitation RPCs.

insert into storage.buckets (id, name, public)
values ('firm-logos', 'firm-logos', true)
on conflict (id) do nothing;

drop policy if exists "firm-logos: public read" on storage.objects;
create policy "firm-logos: public read"
  on storage.objects for select
  using (bucket_id = 'firm-logos');

drop policy if exists "firm-logos: manager insert" on storage.objects;
create policy "firm-logos: manager insert"
  on storage.objects for insert
  with check (
    bucket_id = 'firm-logos'
    and exists (
      select 1 from public.firms f
      where f.public_id = (storage.foldername(storage.objects.name))[1]
        and public.is_firm_owner_or_manager(f.id)
    )
  );

drop policy if exists "firm-logos: manager update" on storage.objects;
create policy "firm-logos: manager update"
  on storage.objects for update
  using (
    bucket_id = 'firm-logos'
    and exists (
      select 1 from public.firms f
      where f.public_id = (storage.foldername(storage.objects.name))[1]
        and public.is_firm_owner_or_manager(f.id)
    )
  );

drop policy if exists "firm-logos: manager delete" on storage.objects;
create policy "firm-logos: manager delete"
  on storage.objects for delete
  using (
    bucket_id = 'firm-logos'
    and exists (
      select 1 from public.firms f
      where f.public_id = (storage.foldername(storage.objects.name))[1]
        and public.is_firm_owner_or_manager(f.id)
    )
  );

create or replace function public.lookup_firm_invitation(p_token text)
returns table (
  firm_name text,
  firm_public_id text,
  firm_logo_url text,
  firm_accent_color text,
  role public.firm_role,
  invitee_email text,
  invitee_full_name text,
  invitee_title text,
  expires_at timestamptz,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    f.name,
    f.public_id,
    f.logo_url,
    f.accent_color,
    fi.role,
    fi.email,
    fi.full_name,
    fi.title,
    fi.expires_at,
    fi.accepted_at
  from public.firm_invitations fi
  join public.firms f on f.id = fi.firm_id
  where fi.token = p_token
  limit 1;
$$;

grant execute on function public.lookup_firm_invitation(text) to anon, authenticated;

create or replace function public.accept_firm_invitation(p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  inv public.firm_invitations%rowtype;
  user_email text;
  firm_pub_id text;
begin
  if auth.uid() is null then
    raise exception 'auth_required';
  end if;

  select email into user_email from auth.users where id = auth.uid();

  select * into inv from public.firm_invitations
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

  insert into public.firm_members (firm_id, user_id, role, title)
  values (inv.firm_id, auth.uid(), inv.role, inv.title)
  on conflict (firm_id, user_id) do update
    set title = coalesce(public.firm_members.title, excluded.title);

  if inv.full_name is not null and inv.full_name <> '' then
    update public.profiles
    set full_name = inv.full_name
    where id = auth.uid()
      and (full_name is null or full_name = '');
  end if;

  update public.firm_invitations
  set accepted_at = now(), accepted_by = auth.uid()
  where id = inv.id;

  select public_id into firm_pub_id from public.firms where id = inv.firm_id;
  return firm_pub_id;
end;
$$;

grant execute on function public.accept_firm_invitation(text) to authenticated;

create or replace function public.handle_new_user_firm_invitations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  for inv in
    select * from public.firm_invitations
    where lower(email) = lower(new.email)
      and accepted_at is null
      and expires_at > now()
  loop
    insert into public.firm_members (firm_id, user_id, role, title)
    values (inv.firm_id, new.id, inv.role, inv.title)
    on conflict (firm_id, user_id) do update
      set title = coalesce(public.firm_members.title, excluded.title);

    update public.firm_invitations
    set accepted_at = now(), accepted_by = new.id
    where id = inv.id;
  end loop;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_firm_invitations on auth.users;
create trigger on_auth_user_created_firm_invitations
after insert on auth.users
for each row execute function public.handle_new_user_firm_invitations();
