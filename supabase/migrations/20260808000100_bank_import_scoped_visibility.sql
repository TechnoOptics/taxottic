-- Bank CSV import visibility: company-wide -> own-rows-or-manager.
--
-- Additive only. Nothing that holds data is dropped: this adds one
-- SECURITY DEFINER helper and replaces eleven policies. No table, column,
-- index or row is touched.
--
-- ---------------------------------------------------------------
-- THE DEFECT
-- ---------------------------------------------------------------
-- Reported by the owner: "Why is grace able to see the expenses that i
-- imported? that should never happen."
--
-- monthly_expenses is correctly scoped (super admin, company manager,
-- own rows, or department lead), so Grace could not see the owner's
-- APPLIED expenses. But bank_imports and bank_transactions -- which
-- hold the very same financial facts BEFORE they are applied, plus the
-- raw merchant names, amounts, dates and descriptions -- were gated on
-- bare is_company_member(company_id). In Techno Optics LLC that let
-- both expensers read all 7 of the owner's CSV imports and all 219 of
-- his bank transactions.
--
-- The same bare-membership shape was on UPDATE and DELETE, not just
-- SELECT. The anon key ships in client JS, so an expenser holding a
-- valid session could DELETE the owner's imports straight through
-- PostgREST without ever loading the app. That is fixed here too.
--
-- ---------------------------------------------------------------
-- THE MODEL, AND WHY
-- ---------------------------------------------------------------
-- Manager (or super admin) sees everything; anyone else sees only the
-- imports they uploaded themselves and the transactions inside them.
-- This is the shape monthly_expenses already uses, minus its
-- department-lead arm.
--
--   1. The live-feed siblings are already manager-only. bank_connections,
--      bank_accounts and account_transactions -- the Plaid/Stripe path to
--      the exact same data class -- are all gated on
--      is_company_manager(...) OR is_super_admin(). The CSV path being
--      company-wide was an inconsistency, not a decision.
--
--   2. Per-user ownership is nonetheless a first-class concept here:
--      bank_imports.user_id exists, its INSERT policy already enforces
--      user_id = auth.uid(), and checkCsvImportLimit() meters the import
--      quota PER USER (lib/plans/usage.ts). Pure manager-only would mean
--      a member who uploads a CSV instantly loses sight of it. Hence
--      own-rows-or-manager rather than manager-only.
--
--   3. No department-lead arm. monthly_expenses lets a lead see their
--      reports' expenses because an expense is an employee's claim that
--      the lead has to approve. A bank import is the COMPANY's bank
--      statement, not an employee claim, and there is no lead review
--      workflow over it. components/LeftRail.tsx puts "import" in
--      LEAD_HIDDEN_KEYS, so the product already says leads do not belong
--      on this surface. Least privilege wins.
--
--   4. No expenser loses anything they legitimately had. The only
--      non-manager surfaces that read these tables through the
--      RLS-respecting client are the AppHeader notification bell and the
--      member dashboard, both via lib/tasks/outstanding.ts, which lists
--      un-categorized bank_transactions company-wide with no user filter.
--      That is not a legitimate need -- it is a second face of the same
--      leak, putting the owner's merchant names and amounts in front of
--      every employee on every page. It closes with this migration and
--      needs no code change. Expense entry never touches these tables.
--
-- bank_transactions has no user_id column, so ownership is derived
-- through import_id -> bank_imports.user_id via owns_bank_import().
-- That helper is SECURITY DEFINER so the nested read is not itself
-- subject to bank_imports' (now narrower) policy.
--
-- Every server action in app/c/[publicId]/import/actions.ts writes
-- through the service-role client, which bypasses RLS, so tightening
-- these policies cannot break the app's own import, apply, categorize
-- or delete paths -- only the direct-from-client ones.
--
-- ---------------------------------------------------------------
-- ROLLBACK
-- ---------------------------------------------------------------
-- Restore the previous (leaky) behaviour by re-running these ten
-- bodies. The helper function can be left in place harmlessly.
--
--   drop policy if exists "imports: scoped read"   on public.bank_imports;
--   drop policy if exists "imports: scoped update" on public.bank_imports;
--   drop policy if exists "imports: scoped delete" on public.bank_imports;
--   create policy "imports: member read"   on public.bank_imports for select
--     using (is_company_member(company_id) or is_super_admin());
--   create policy "imports: member update" on public.bank_imports for update
--     using (is_company_member(company_id)) with check (is_company_member(company_id));
--   create policy "imports: member delete" on public.bank_imports for delete
--     using (is_company_member(company_id));
--
--   drop policy if exists "transactions: scoped read"   on public.bank_transactions;
--   drop policy if exists "transactions: scoped write"  on public.bank_transactions;
--   drop policy if exists "transactions: scoped update" on public.bank_transactions;
--   drop policy if exists "transactions: scoped delete" on public.bank_transactions;
--   create policy "transactions: member read"   on public.bank_transactions for select
--     using (is_company_member(company_id) or is_super_admin());
--   create policy "transactions: member write"  on public.bank_transactions for insert
--     with check (is_company_member(company_id));
--   create policy "transactions: member update" on public.bank_transactions for update
--     using (is_company_member(company_id)) with check (is_company_member(company_id));
--   create policy "transactions: member delete" on public.bank_transactions for delete
--     using (is_company_member(company_id));
--
--   drop policy if exists "bank_import_duplicates_select" on public.bank_import_duplicates;
--   drop policy if exists "bank_import_duplicates_insert" on public.bank_import_duplicates;
--   drop policy if exists "bank_import_duplicates_update" on public.bank_import_duplicates;
--   drop policy if exists "bank_import_duplicates_delete" on public.bank_import_duplicates;
--   create policy "bank_import_duplicates_select" on public.bank_import_duplicates for select
--     using (is_company_member(company_id) or is_super_admin());
--   create policy "bank_import_duplicates_insert" on public.bank_import_duplicates for insert
--     with check (is_company_member(company_id));
--   create policy "bank_import_duplicates_update" on public.bank_import_duplicates for update
--     using (is_company_member(company_id)) with check (is_company_member(company_id));
--   create policy "bank_import_duplicates_delete" on public.bank_import_duplicates for delete
--     using (is_company_member(company_id));

begin;

-- ---------------------------------------------------------------
-- Helper: does the caller own the import this row belongs to?
-- ---------------------------------------------------------------
-- SECURITY DEFINER, matching is_company_member / is_company_manager /
-- is_department_lead_of_user. Without it the nested bank_imports read
-- would be filtered by bank_imports' own policy, which is exactly the
-- policy being defined in terms of this function on the sibling tables.
create or replace function public.owns_bank_import(p_import_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.bank_imports i
    where i.id = p_import_id
      and i.user_id = auth.uid()
  );
$$;

comment on function public.owns_bank_import(uuid) is
  'True when the current user uploaded the given bank_imports row. Used to scope bank_transactions and bank_import_duplicates, neither of which carries a user_id of its own.';

-- ---------------------------------------------------------------
-- bank_imports
-- ---------------------------------------------------------------
drop policy if exists "imports: member read" on public.bank_imports;
create policy "imports: scoped read"
  on public.bank_imports
  for select
  using (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and user_id = auth.uid())
  );

drop policy if exists "imports: member update" on public.bank_imports;
create policy "imports: scoped update"
  on public.bank_imports
  for update
  using (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and user_id = auth.uid())
  )
  with check (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and user_id = auth.uid())
  );

drop policy if exists "imports: member delete" on public.bank_imports;
create policy "imports: scoped delete"
  on public.bank_imports
  for delete
  using (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and user_id = auth.uid())
  );

-- INSERT is left exactly as it was: it already required
-- is_company_member(company_id) AND user_id = auth.uid(), i.e. you may
-- only create imports owned by yourself. Uploading stays open to every
-- member, as it is today, and is metered per user by the plan quota.

-- ---------------------------------------------------------------
-- bank_transactions  (ownership derived via import_id)
-- ---------------------------------------------------------------
drop policy if exists "transactions: member read" on public.bank_transactions;
create policy "transactions: scoped read"
  on public.bank_transactions
  for select
  using (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and owns_bank_import(import_id))
  );

drop policy if exists "transactions: member write" on public.bank_transactions;
create policy "transactions: scoped write"
  on public.bank_transactions
  for insert
  with check (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and owns_bank_import(import_id))
  );

drop policy if exists "transactions: member update" on public.bank_transactions;
create policy "transactions: scoped update"
  on public.bank_transactions
  for update
  using (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and owns_bank_import(import_id))
  )
  with check (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and owns_bank_import(import_id))
  );

drop policy if exists "transactions: member delete" on public.bank_transactions;
create policy "transactions: scoped delete"
  on public.bank_transactions
  for delete
  using (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and owns_bank_import(import_id))
  );

-- ---------------------------------------------------------------
-- bank_import_duplicates
-- ---------------------------------------------------------------
-- Currently unreferenced by application code and empty in production,
-- but it carries description + amount_cents for rows rejected as
-- duplicates during an import, which is the same financial data under
-- a different name. Scoped identically so it cannot become the next
-- leak the moment something starts writing to it.
drop policy if exists "bank_import_duplicates_select" on public.bank_import_duplicates;
create policy "bank_import_duplicates_select"
  on public.bank_import_duplicates
  for select
  using (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and owns_bank_import(import_id))
  );

drop policy if exists "bank_import_duplicates_insert" on public.bank_import_duplicates;
create policy "bank_import_duplicates_insert"
  on public.bank_import_duplicates
  for insert
  with check (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and owns_bank_import(import_id))
  );

drop policy if exists "bank_import_duplicates_update" on public.bank_import_duplicates;
create policy "bank_import_duplicates_update"
  on public.bank_import_duplicates
  for update
  using (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and owns_bank_import(import_id))
  )
  with check (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and owns_bank_import(import_id))
  );

drop policy if exists "bank_import_duplicates_delete" on public.bank_import_duplicates;
create policy "bank_import_duplicates_delete"
  on public.bank_import_duplicates
  for delete
  using (
    is_super_admin()
    or is_company_manager(company_id)
    or (is_company_member(company_id) and owns_bank_import(import_id))
  );

commit;
