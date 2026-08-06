-- Recovered 20260428224444 (business_profile_employee_count) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

-- Refines has_employees: now we track the actual headcount range so we can
-- enforce the employee invitation cap.
alter table public.business_profiles
  add column if not exists employee_count int;

-- Backfill: if has_employees was true but no count, default to 1.
update public.business_profiles
set employee_count = 1
where has_employees = true and employee_count is null;

-- And explicit 0 for the rest.
update public.business_profiles
set employee_count = 0
where has_employees = false and employee_count is null;
