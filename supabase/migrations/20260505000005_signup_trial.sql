-- 1-week free trial on signup, no credit card required.
--
-- New users land on the Solo tier for 7 days with a 400-credit grant.
-- After the trial ends, getActivePlan flips them to free; their data
-- and credit balance persist, but Bella + bank sync + receipt OCR stop
-- working until they pick a paid tier.
--
-- Implementation:
--   1. Extend sub_plan enum with the 5 tiers introduced in PR #16
--      (was missing — webhook writes would have failed on first
--      tier-conversion event in production).
--   2. handle_new_user trigger seeds:
--        subscriptions (plan='solo', status='trialing', trial_end=now()+7d)
--        credits_ledger (+400 credits, reason='trial_grant')
--   3. The application's getActivePlan helper checks trial_end and
--      treats expired trials as free without rewriting the row, so
--      the audit trail of "they had a trial" is preserved.

-- Step 1: extend sub_plan enum
alter type public.sub_plan add value if not exists 'filer';
alter type public.sub_plan add value if not exists 'solo';
alter type public.sub_plan add value if not exists 'studio';
alter type public.sub_plan add value if not exists 'scale';
alter type public.sub_plan add value if not exists 'practice';

-- Step 2: signup trigger now seeds a trial subscription + credits.
-- We replace the existing function (the previous body just creates a
-- profile and accepts pending invitations); we extend it to also seed
-- the trial.
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

  -- Auto-accept any pending invitations for this email.
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

  -- Seed a 7-day trial on Solo. trial_end is the only field the
  -- application reads to decide whether the trial is still active.
  insert into public.subscriptions (
    user_id, plan, status, trial_end, last_credit_grant_at
  )
  values (
    new.id, 'solo', 'trialing', now() + interval '7 days', now()
  )
  on conflict (user_id) do nothing;

  -- Grant 400 trial credits (matches Solo's monthly grant in
  -- lib/plans/limits.ts) so the user can actually exercise the
  -- product. Reason is 'trial_grant' (not 'monthly_grant') so when
  -- they convert to paid, ensureMonthlyGrant fires a fresh grant
  -- instead of being suppressed by the 27-day idempotency check.
  insert into public.credits_ledger (user_id, delta_credits, reason, ref_id)
  values (new.id, 400, 'trial_grant', 'signup');

  return new;
end;
$$;
