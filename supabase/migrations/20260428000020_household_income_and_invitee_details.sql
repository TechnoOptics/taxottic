-- Household income capture + richer invitations.
--
-- Why: many self-employed people moonlight - they have a W-2 day job AND
-- a side business. The forecast was treating spouse_income_cents as
-- "spouse's W-2" but had no spot for the OWNER's W-2, no spot for either
-- party's federal withholding (which counts as already-paid), and no way
-- to separate dependents under 17 (who qualify for the Child Tax Credit
-- at $2,000 each) from other dependents (who get the $500 Credit for
-- Other Dependents). It also had no concrete itemized total: the user
-- could toggle "I will itemize" but couldn't say how much.
--
-- This migration adds:
--   * Owner W-2 wages, withholding, and Social Security wages
--   * Spouse W-2 wages, withholding, and Social Security wages (the
--     existing spouse_income_cents stays as a generic fallback for users
--     who haven't broken it out yet, but the engine prefers the new
--     fields when set)
--   * dependents_under_17 for CTC eligibility
--   * itemized_total_cents so a user who plans to itemize can enter the
--     amount they expect to claim
--   * full_name + title + personal_message on invitations so a manager
--     setting up an employee can send a personal welcome instead of a
--     bare email link
alter table public.tax_profiles
  add column if not exists owner_w2_wages_cents bigint not null default 0,
  add column if not exists owner_w2_withheld_cents bigint not null default 0,
  add column if not exists owner_w2_ss_wages_cents bigint not null default 0,
  add column if not exists spouse_w2_wages_cents bigint not null default 0,
  add column if not exists spouse_w2_withheld_cents bigint not null default 0,
  add column if not exists spouse_w2_ss_wages_cents bigint not null default 0,
  add column if not exists dependents_under_17 int not null default 0,
  add column if not exists itemized_total_cents bigint not null default 0;

-- Sanity: dependents_under_17 cannot exceed dependents.
alter table public.tax_profiles
  drop constraint if exists tax_profiles_dependents_under_17_lte_total;
alter table public.tax_profiles
  add constraint tax_profiles_dependents_under_17_lte_total
  check (dependents_under_17 >= 0 and dependents_under_17 <= dependents);

alter table public.invitations
  add column if not exists full_name text,
  add column if not exists title text,
  add column if not exists personal_message text;
