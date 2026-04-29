-- When a user signs up via an emailed invitation link, copy the
-- manager-supplied full_name onto the new profile (when not already set
-- via the OAuth provider's name claim) and the title onto their
-- company_members row.
--
-- Why: the manager just typed the new hire's name and job title into the
-- "Add employee" form. Those should land on the user's identity so the
-- new hire arrives to a personalized welcome and the team page shows
-- the right job title without them having to re-enter it.
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
  -- Pull a "best" full_name in priority order: invitation > OAuth claim
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

  -- Auto-accept any pending invitations for this email, carrying over
  -- the title onto the membership row.
  for inv in
    select * from public.invitations
    where lower(email) = lower(new.email)
      and accepted_at is null
      and expires_at > now()
  loop
    insert into public.company_members (company_id, user_id, role, title)
    values (inv.company_id, new.id, inv.role, inv.title)
    on conflict (company_id, user_id) do update
      set title = coalesce(public.company_members.title, excluded.title);

    update public.invitations
    set accepted_at = now(), accepted_by = new.id
    where id = inv.id;
  end loop;

  return new;
end;
$$;
