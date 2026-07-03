-- New narrowest role: "expenser" can only log their own expenses/mileage
-- and use chat — no forecast, income, roster, or company-settings access.
-- ALTER TYPE ... ADD VALUE can't run in the same transaction as code that
-- references the new value (same constraint hit when adding "lead"), so
-- this is its own migration.
alter type public.company_role add value if not exists 'expenser';
