-- Recovered 20260506021413 (signup_trial) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter type public.sub_plan add value if not exists 'filer';
alter type public.sub_plan add value if not exists 'solo';
alter type public.sub_plan add value if not exists 'studio';
alter type public.sub_plan add value if not exists 'scale';
alter type public.sub_plan add value if not exists 'practice';

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
    insert into public.company_members (company_id, user_id, role, title)
    values (inv.company_id, new.id, inv.role, inv.title)
    on conflict (company_id, user_id) do update
      set title = coalesce(public.company_members.title, excluded.title);

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
