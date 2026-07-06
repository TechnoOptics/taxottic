-- Audit fix: hard-deleting a user (admin deleteUserHard → auth.admin.deleteUser)
-- silently FAILED for any user who had income/expense rows or who created a
-- company, because these FKs were ON DELETE RESTRICT. The admin action's own
-- comment claimed cascade, but the schema said restrict. This aligns the schema
-- with the intended "erase the user's data" behavior so the delete succeeds.
--
--   monthly_income.user_id / monthly_expenses.user_id → CASCADE
--     (the user's financial rows are theirs; erase them with the user, matching
--      GDPR-erasure intent and the deleteUserHard docstring)
--   companies.created_by → SET NULL (column made nullable)
--     (a company owned/used by other members must survive the creator's
--      deletion; we just forget who created it)

alter table public.monthly_income
  drop constraint monthly_income_user_id_fkey,
  add constraint monthly_income_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.monthly_expenses
  drop constraint monthly_expenses_user_id_fkey,
  add constraint monthly_expenses_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete cascade;

alter table public.companies
  alter column created_by drop not null;

alter table public.companies
  drop constraint companies_created_by_fkey,
  add constraint companies_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete set null;
