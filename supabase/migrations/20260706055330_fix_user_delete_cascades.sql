-- Recovered 20260706055330 (fix_user_delete_cascades) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

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
