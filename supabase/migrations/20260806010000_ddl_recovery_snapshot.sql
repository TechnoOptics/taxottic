-- TEMPORARY. Surfaces supabase_migrations.schema_migrations into a table the
-- service role can read through PostgREST, so the DDL of migrations applied
-- out-of-band can be written back into supabase/migrations/. Dropped by the
-- very next migration. RLS is enabled with NO policies, so anon and
-- authenticated get nothing; only the service role (which bypasses RLS) reads.
create table if not exists public._ddl_recovery (
  version text primary key,
  name text,
  statements text[]
);
alter table public._ddl_recovery enable row level security;
revoke all on public._ddl_recovery from anon, authenticated;
truncate public._ddl_recovery;
insert into public._ddl_recovery (version, name, statements)
select version, name, statements from supabase_migrations.schema_migrations;
