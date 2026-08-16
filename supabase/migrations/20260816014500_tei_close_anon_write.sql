-- Close the anonymous write path into taxottic_enterprise_inquiries.
--
-- 20260503185416_tei_grants_only_lockdown.sql deliberately turned RLS OFF
-- on this table and granted anon INSERT, relying on GRANTs alone. Its
-- reasoning was sound at the time and is quoted here so this is not read
-- as reversing a decision without cause:
--
--   "We rely on GRANTs alone (RLS off) because RLS evaluation is
--    misbehaving under the project's anon role context. The Vercel API
--    route validates inputs before insert."
--
-- BOTH halves of that justification have since expired:
--
--   1. There is no such API route any more. A grep of app/ and lib/ finds
--      ZERO references to this table in application code; the only hits
--      are migrations. Lead capture moved to firm_access_requests, which
--      is what app/firms/request-account/actions.ts writes, server-side,
--      with the service role.
--   2. The table has taken no rows since 2026-05-10, three months before
--      this migration.
--
-- What the grant still permitted, meanwhile, was an anonymous INSERT with
-- NO column restriction. anon could not READ (no select grant, which is
-- the property that kept prospect contact details safe), but it could
-- write admin-controlled columns: status, admin_notes, billing,
-- subscription, onboarded_firm_id, onboarded_at. A forged row claiming
-- status='onboarded' with an arbitrary onboarded_firm_id lands in an
-- admin workflow that has no reason to distrust it.
--
-- Dormant capability plus admin-controlled columns plus no validating
-- caller is not a risk worth carrying for a form that no longer exists.
--
-- RLS is re-enabled with NO policies, which denies anon and authenticated
-- outright. service_role bypasses RLS, so admin reads and writes are
-- unaffected, and the three existing rows are untouched.
--
-- TO REVERSE, if a lead form turns out to still post here:
--   grant insert on public.taxottic_enterprise_inquiries to anon;
--   alter table public.taxottic_enterprise_inquiries disable row level security;
-- Better, though: route it through a server action with the service role,
-- the way firm_access_requests already does.

revoke insert on public.taxottic_enterprise_inquiries from anon;
revoke all on public.taxottic_enterprise_inquiries from anon, authenticated;

alter table public.taxottic_enterprise_inquiries enable row level security;

comment on table public.taxottic_enterprise_inquiries is
  'Enterprise lead inquiries. RLS ON with no policies: service_role only. '
  'Dormant since 2026-05-10; live lead capture is firm_access_requests. '
  'Do NOT re-grant anon INSERT without a column-restricted policy, the '
  'admin columns (status, onboarded_firm_id, billing) are forgeable.';
