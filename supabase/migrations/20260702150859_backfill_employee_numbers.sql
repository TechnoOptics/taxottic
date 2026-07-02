-- Backfill employee_number for every company_members row that predates
-- the assign_employee_number trigger (20260702145621). Sequential per
-- company, ordered by joined_at so the earliest member (almost always
-- the manager/creator) becomes #1 — matches what the trigger would have
-- assigned had it existed at signup time. Idempotent: only touches rows
-- where employee_number is still null.
with numbered as (
  select
    user_id,
    company_id,
    row_number() over (partition by company_id order by joined_at) as n
  from public.company_members
  where employee_number is null
)
update public.company_members cm
set employee_number = numbered.n
from numbered
where cm.user_id = numbered.user_id
  and cm.company_id = numbered.company_id
  and cm.employee_number is null;
