-- Fleet Adapter Contract v1: the sandbox tenant boundary.
--
-- Techno Optics runs nine products. A prospect evaluating the suite is given
-- one credential that works on all nine, and the container their trial lives
-- in is a "sandbox tenant". This migration builds the boundary that separates
-- a sandbox tenant from every real tenant, in both directions:
--
--   nothing real gets in    a sandbox session can reach no real company's row
--   nothing sandboxed gets out  a real session can reach no sandbox row, and
--                               no real report counts one
--
-- Taxottic holds real taxpayer data for multiple clients. The endpoint that
-- mints these logins hands the credential to a stranger, every time, by
-- design. If a sandbox can reach a real row, a sales demo is a data breach.
-- The contract is explicit that this boundary is built and proved BEFORE any
-- endpoint exists, because no endpoint fails safe (the Hub gets a 404 and
-- records the product as not integrated) while a half-built one invites the
-- Hub to hand out credentials that look safe and are not.
--
-- WHY A RESTRICTIVE POLICY AND NOT A COLUMN FILTER
--
-- An `is_sandbox` column that individual queries remember to filter on is
-- explicitly rejected by the contract: a rule enforced in two hundred places
-- is not enforced. What is required is one predicate that no data access can
-- skip. In Postgres that is row-level security, and specifically a
-- RESTRICTIVE policy, which ANDs with the permissive policies already on
-- these tables. A restrictive policy can only ever narrow access. It cannot
-- grant anything, so it cannot open a hole in the existing tenancy rules.
--
-- WHY THIS IS A NO-OP ON THE DATABASE AS IT STANDS TODAY
--
-- `companies.sandbox` defaults to false and no row sets it. So
-- `hq_sandbox_company_ids()` returns the empty set, `hq_session_is_sandbox()`
-- is false for every session, and the barrier reduces to `false = false` for
-- every existing row. Nothing changes. The boundary only starts refusing
-- anything once the first sandbox tenant exists, which no code in this
-- repository creates yet (see docs/design/fleet-integration.md, blocker Q1).
--
-- WHAT THIS MIGRATION DOES NOT COVER, STATED SO IT IS NOT MISTAKEN FOR
-- COVERAGE
--
-- Supabase's `service_role` carries BYPASSRLS. All 92 of this repo's
-- createServiceClient() call sites therefore skip this predicate entirely.
-- That gap is real and is the hardest part of the contract's one-predicate
-- rule in this codebase. It is NOT closed here and it is not closed anywhere
-- else yet. docs/design/fleet-integration.md states what is required before
-- the first sandbox tenant is provisioned; read it before assuming this file
-- makes a sandbox safe.

-- ---------------------------------------------------------------------------
-- 1. The tenant flag.
-- ---------------------------------------------------------------------------
-- Contract section 6.3: the predicate is for data, the flag is for the egress
-- decisions in 6.5, which run in queue workers and cron jobs that are nowhere
-- near a user session and need a cheap answer to "is this tenant a sandbox".
-- You need both; the flag alone is the rejected mechanism.
alter table public.companies
  add column if not exists sandbox boolean not null default false;

comment on column public.companies.sandbox is
  'True for a Techno Optics fleet sandbox tenant (a prospect trial). Never true for a real customer. Set only by the /hq provisioning path; read by the egress chokepoints and excluded from every real-tenant count.';

-- Partial index so "every sandbox tenant" and "every real tenant" are both
-- cheap. report_counts runs the second on every Hub poll.
create index if not exists companies_sandbox_idx
  on public.companies (id) where sandbox;

-- ---------------------------------------------------------------------------
-- 2. The one predicate.
-- ---------------------------------------------------------------------------

-- Is the CALLER in the sandbox realm? A session is sandbox if it holds any
-- membership of any sandbox company. Provisioning must never add a sandbox
-- membership to a user who already holds a real one; that invariant is what
-- makes a single boolean an honest answer, and it is asserted by
-- supabase/tests/rls-hq-sandbox-isolation.sql.
--
-- SECURITY DEFINER is required, not convenient: the function reads
-- company_members and companies, both of which carry the barrier below. An
-- invoker-rights function would recurse.
create or replace function public.hq_session_is_sandbox()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.company_members m
    join public.companies c on c.id = m.company_id
    where m.user_id = auth.uid()
      and c.sandbox
  );
$$;

-- The sandbox tenants, as a set.
--
-- Returns a SET rather than taking the row's company_id as an argument on
-- purpose. Used as `company_id in (select public.hq_sandbox_company_ids())`
-- the subquery is uncorrelated, so the planner evaluates it once per
-- statement and hashes it, instead of calling a function per row.
-- mileage_points_raw is large and is read on every /mileage render; a
-- per-row predicate there would be felt.
--
-- It returns the SANDBOX ids rather than "the ids in the caller's realm",
-- and that is a security decision, not a stylistic one. Both forms work as a
-- predicate. The realm form returns EVERY NON-SANDBOX COMPANY ID to a
-- non-sandbox caller, and because an RLS predicate has to be executable by
-- every role the policy applies to, anon can execute it, and Supabase exposes
-- public functions at /rest/v1/rpc/. That is a customer enumeration oracle
-- reachable without a session, and the tenant count is exactly the number
-- report_counts exists to keep internal. This form returns only the ids of
-- the demo tenants, of which there are zero today, and it is the smaller set
-- to hash besides.
create or replace function public.hq_sandbox_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id from public.companies c where c.sandbox;
$$;

-- definer-grant-ok: hq_session_is_sandbox  row-level-security predicate: every role a policy applies to must be able to execute it, and it returns one boolean derived solely from the caller's own auth.uid()
-- definer-grant-ok: hq_sandbox_company_ids  row-level-security predicate: every role a policy applies to must be able to execute it, and it returns only the ids of sandbox tenants, never a real customer's

-- These are RLS predicates. A role that cannot execute them cannot be
-- evaluated against the policy at all, so anon and authenticated both need
-- EXECUTE, and revoking it would turn an anonymous read of these tables into
-- an error rather than an empty result.
grant execute on function public.hq_session_is_sandbox() to anon, authenticated, service_role;
grant execute on function public.hq_sandbox_company_ids() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. The barrier, on the tenant table itself.
-- ---------------------------------------------------------------------------
-- Expressed against the column directly rather than through
-- hq_sandbox_company_ids(), which reads this table: the direct form is what
-- breaks the recursion.
drop policy if exists hq_sandbox_barrier on public.companies;
create policy hq_sandbox_barrier on public.companies
  as restrictive
  for all
  to public
  using (sandbox = public.hq_session_is_sandbox())
  with check (sandbox = public.hq_session_is_sandbox());

-- ---------------------------------------------------------------------------
-- 4. The barrier, on every table carrying a tenant reference.
-- ---------------------------------------------------------------------------
-- The list is the set of public tables with a `company_id` column, taken from
-- the database catalog, not from memory. lib/hq/catalog.ts re-derives it from
-- these migrations and lib/hq/boundary.test.ts fails when a table is added
-- with a company_id and no barrier. That test is the thing that keeps this
-- list true after everyone who wrote it has moved on.
--
-- A NULL company_id passes. Those rows are not tenant-scoped (a personal
-- reminder, a firm-level document with no client company attached) and are
-- already scoped by user or firm in the permissive policies. Making NULL fail
-- would delete access to rows this boundary has no opinion about.
do $$
declare
  t text;
  tenant_tables text[] := array[
    'admin_cross_tenant_access_log',
    'bank_connections',
    'bank_import_duplicates',
    'bank_imports',
    'bank_transactions',
    'bella_conversations',
    'business_profiles',
    'categorization_rules',
    'chat_conversations',
    'company_activity',
    'company_members',
    'company_state_nexus',
    'departments',
    'firm_activity_log',
    'firm_documents',
    'firm_efilings',
    'firm_engagements',
    'firm_invoice_templates',
    'firm_invoices',
    'firm_meetings',
    'goals',
    'invitations',
    'mileage_device_heartbeats',
    'mileage_device_status',
    'mileage_learned_places',
    'mileage_places',
    'mileage_points_raw',
    'mileage_render_refusals',
    'mileage_tracker_alerts',
    'mileage_trips',
    'monthly_expenses',
    'monthly_income',
    'prior_year_documents',
    'reminders',
    'sales_tax_records',
    'team_messages'
  ];
begin
  foreach t in array tenant_tables loop
    execute format('drop policy if exists hq_sandbox_barrier on public.%I', t);
    execute format(
      'create policy hq_sandbox_barrier on public.%I as restrictive for all to public '
      || 'using (company_id is null or (company_id in (select public.hq_sandbox_company_ids())) = public.hq_session_is_sandbox()) '
      || 'with check (company_id is null or (company_id in (select public.hq_sandbox_company_ids())) = public.hq_session_is_sandbox())',
      t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Two child tables the parent barrier does not reach.
-- ---------------------------------------------------------------------------
-- Most tables without a company_id are still covered, because their own read
-- policy contains an EXISTS over a parent that does carry the barrier, and
-- Postgres applies the parent's RLS inside that subquery. chat_conversation_
-- members and chat_conversation_reads are the exception: they resolve through
-- can_access_conversation(), which is SECURITY DEFINER and therefore does not
-- see the parent's RLS at all.
--
-- That helper does still require company membership, so the case it leaves
-- open is narrow and specific: a user holding a membership in a real company
-- AND in a sandbox one. Provisioning must never create that user. These two
-- policies are what make the database enforce it rather than the endpoint
-- remembering to, and supabase/tests/rls-hq-sandbox-isolation.sql asserts it.
--
-- Which tables were checked and cleared, and by what evidence, is in
-- docs/design/fleet-integration.md. It was read out of pg_policy, not guessed.
drop policy if exists hq_sandbox_barrier on public.chat_conversation_members;
create policy hq_sandbox_barrier on public.chat_conversation_members
  as restrictive
  for all
  to public
  using (exists (
    select 1 from public.chat_conversations cc
    where cc.id = chat_conversation_members.conversation_id
      and (cc.company_id is null
           or (cc.company_id in (select public.hq_sandbox_company_ids()))
              = public.hq_session_is_sandbox())
  ))
  with check (exists (
    select 1 from public.chat_conversations cc
    where cc.id = chat_conversation_members.conversation_id
      and (cc.company_id is null
           or (cc.company_id in (select public.hq_sandbox_company_ids()))
              = public.hq_session_is_sandbox())
  ));

drop policy if exists hq_sandbox_barrier on public.chat_conversation_reads;
create policy hq_sandbox_barrier on public.chat_conversation_reads
  as restrictive
  for all
  to public
  using (exists (
    select 1 from public.chat_conversations cc
    where cc.id = chat_conversation_reads.conversation_id
      and (cc.company_id is null
           or (cc.company_id in (select public.hq_sandbox_company_ids()))
              = public.hq_session_is_sandbox())
  ))
  with check (exists (
    select 1 from public.chat_conversations cc
    where cc.id = chat_conversation_reads.conversation_id
      and (cc.company_id is null
           or (cc.company_id in (select public.hq_sandbox_company_ids()))
              = public.hq_session_is_sandbox())
  ));
