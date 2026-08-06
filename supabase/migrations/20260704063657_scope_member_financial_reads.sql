-- Recovered 20260704063657 (scope_member_financial_reads) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Scope member financial reads (privacy fix). Non-managers see only their
-- own income/expense rows; managers see all; department leads see their
-- department's members. Firm-engaged read policy is left intact.

drop policy if exists "monthly_income: member read" on public.monthly_income;
drop policy if exists "monthly_income: scoped read" on public.monthly_income;
create policy "monthly_income: scoped read"
  on public.monthly_income for select
  using (
    public.is_super_admin()
    or public.is_company_manager(company_id)
    or (public.is_company_member(company_id) and user_id = auth.uid())
    or public.is_department_lead_of_user(company_id, user_id)
  );

drop policy if exists "monthly_expenses: member read" on public.monthly_expenses;
drop policy if exists "monthly_expenses: scoped read" on public.monthly_expenses;
create policy "monthly_expenses: scoped read"
  on public.monthly_expenses for select
  using (
    public.is_super_admin()
    or public.is_company_manager(company_id)
    or (public.is_company_member(company_id) and user_id = auth.uid())
    or public.is_department_lead_of_user(company_id, user_id)
  );
