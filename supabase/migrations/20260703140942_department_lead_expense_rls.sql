-- A department lead reviews expenses ONLY for teammates in their own
-- department — never company-wide (that stays manager-only). Mirrors
-- is_company_manager()'s shape but additionally requires the caller's
-- own department_id to match the target row's owner's department_id.
create or replace function public.is_department_lead_of_user(p_company_id uuid, p_target_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from company_members lead_row
    join company_members target_row
      on target_row.company_id = lead_row.company_id
     and target_row.department_id = lead_row.department_id
    where lead_row.user_id = auth.uid()
      and lead_row.role = 'lead'
      and lead_row.company_id = p_company_id
      and target_row.user_id = p_target_user_id
      and lead_row.department_id is not null
  );
$$;

grant execute on function public.is_department_lead_of_user(uuid, uuid) to authenticated;

-- Extend the existing "own or manager update" policy so a department
-- lead can also update (reclassify/comment on) an expense belonging to
-- a teammate in their own department. Delete stays manager-only —
-- leads can review, not remove, a teammate's record.
drop policy if exists "monthly_expenses: own or manager update" on public.monthly_expenses;
create policy "monthly_expenses: own or manager update"
  on public.monthly_expenses for update
  using (
    (is_company_member(company_id) and (user_id = auth.uid()))
    or is_company_manager(company_id)
    or is_super_admin()
    or is_department_lead_of_user(company_id, user_id)
  )
  with check (
    (is_company_member(company_id) and (user_id = auth.uid()))
    or is_company_manager(company_id)
    or is_super_admin()
    or is_department_lead_of_user(company_id, user_id)
  );
