-- Scope member financial reads (privacy fix).
--
-- Before this, monthly_income and monthly_expenses let ANY company member
-- read EVERY row in the company ("team transparency"). That means a plain
-- member (or the narrowest "expenser") could see everyone's income and
-- expenses, and the forecast built on that data. Product decision: reverse
-- it. A member should only see their OWN financial rows.
--
-- New SELECT rule, both tables:
--   - super admin                         -> all rows
--   - manager (is_company_manager)        -> all rows in the company
--   - department lead                     -> rows of members in their dept
--   - any other member / expenser         -> only their own rows (user_id = auth.uid())
--
-- INSERT/UPDATE/DELETE policies are unchanged: they were already own-or-manager
-- (plus the department-lead update path), so no one loses write access.

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
