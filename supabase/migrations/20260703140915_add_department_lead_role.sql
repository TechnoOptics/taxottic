-- New "lead" access level: a department lead reviews/reclassifies
-- expenses and views the forecast breakdown for their own department
-- only — narrower than manager (full company access + invite rights),
-- broader than member (own records only). Enum value added in its own
-- migration; Postgres forbids using a freshly added enum value in the
-- same transaction it was created in, so RLS/functions referencing
-- 'lead' live in the next migration.
alter type public.company_role add value if not exists 'lead';
