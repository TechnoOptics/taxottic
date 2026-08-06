-- Drops the temporary recovery table created by 20260806010000. It existed
-- only long enough to copy supabase_migrations.schema_migrations out through
-- PostgREST; the DDL now lives in this folder as real migration files.
drop table if exists public._ddl_recovery;
