-- Invitation tokens resolved forever, including accepted and expired ones.
--
-- Both lookups matched on `token` alone with no lifecycle predicate:
--
--   where i.token = p_token limit 1
--
-- So anyone holding an old invite link kept getting back the company or
-- firm name, its public_id, the invitee's email, full name, title and
-- personal message, indefinitely. The token is the only secret, invitation
-- links travel through email and get forwarded, and nothing ever stopped
-- honouring one.
--
-- Live when this was written: 3 of 3 invitations were stale (2 accepted,
-- 3 past expiry) and all 3 still resolved.
--
-- WHAT CHANGES, AND WHY IT IS "NO ROWS" RATHER THAN A REDACTED ROW.
--
-- A stale token now returns nothing. app/invite/[token]/page.tsx already
-- renders "This link is invalid or has expired." on an empty result, so
-- the user-facing behaviour is correct with no client change.
--
-- The redacted-row alternative was considered and rejected: for an ACCEPTED
-- invite the page returns early with "already used" and would be fine, but
-- for an EXPIRED one it falls through to rendering `company_name`, which
-- would print "You are invited to null". A generic answer is also the
-- better security posture: it does not confirm whether a token ever
-- existed, only that this one is not usable.
--
-- lookup_invitation KEEPS its anon grant. app/invite/[token]/page.tsx calls
-- it with the user's own (anon) client, by design: an invitee has no
-- session yet.
--
-- lookup_firm_invitation LOSES its anon grant. It has no caller anywhere in
-- the repo, only a comment in app/admin/firms/actions.ts describing a page
-- that was never built. An anon-callable SECURITY DEFINER function with no
-- consumer is pure attack surface, and this codebase has a documented habit
-- of leaving exactly that lying around. If the firm invite page is built
-- later, grant it back deliberately, or call it with the service-role
-- client as the W-9 flow does.

-- definer-grant-ok: lookup_invitation  an invitee has no account yet, so
--   app/invite/[token]/page.tsx must call this with the anon client; the
--   token plus the lifecycle gate below are the access control.
create or replace function public.lookup_invitation(p_token text)
returns table (
  company_name text,
  company_public_id text,
  role company_role,
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
set search_path to 'public'
as $function$
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
    -- The lifecycle gate. Without these two the token never stops working.
    and i.accepted_at is null
    and i.expires_at > now()
  limit 1;
$function$;

create or replace function public.lookup_firm_invitation(p_token text)
returns table (
  firm_name text,
  firm_public_id text,
  firm_logo_url text,
  firm_accent_color text,
  role firm_role,
  invitee_email text,
  invitee_full_name text,
  invitee_title text,
  expires_at timestamptz,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $function$
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
    and fi.accepted_at is null
    and fi.expires_at > now()
  limit 1;
$function$;

-- No caller today. Loop over OIDs so an overload cannot slip past, the same
-- pattern as 20260808060000.
do $$
declare fn record;
begin
  for fn in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'lookup_firm_invitation'
  loop
    execute format('revoke execute on function %s from anon, authenticated, public', fn.sig);
    raise notice 'revoked anon/authenticated/public EXECUTE on %', fn.sig;
  end loop;
end $$;
