-- Expand tax_profiles with structured fields for the federal benefits
-- the forecast engine wasn't surfacing yet.
--
-- Up until now the engine collected one aggregate "above-the-line"
-- number plus a single "itemized total". That worked for the simplest
-- W-2 + Schedule C case but quietly leaves a lot of common deductions
-- and credits invisible:
--
--   * Retirement contributions (Solo 401(k), SEP-IRA, Traditional IRA,
--     HSA): the single biggest tax-saving lever for a self-employed
--     filer with profit. Without a dedicated field we can't even prompt
--     the user, let alone deduct it or recommend a target.
--   * Self-employed health insurance: above-the-line deduction for
--     anyone buying their own plan.
--   * Long-term capital gains + qualified dividends: taxed at separate
--     0/15/20% brackets that the engine has been bundling into ordinary
--     income, over-stating tax for users with investment income.
--   * Foreign earned income: $132,900 exclusion (TY 2026) for citizens
--     working abroad.
--   * Student loan interest: $2,500 above-the-line deduction with its
--     own phase-out.
--   * Itemized sub-types (SALT, mortgage, charity, medical): collected
--     individually rather than as a lump so we can warn about the SALT
--     cap and help the user reason about which to claim.
--   * § 179 expensing election: capital purchases the user wants to
--     expense up to the year's cap ($2.56M for 2026 per OBBBA § 70306).
--   * Residential energy + EV credits, ACA Premium Tax Credit advance
--     payments, qualified education expenses, Roth IRA contribution
--     (the Roth itself isn't deductible but the contribution is the
--     input for the Saver's Credit).
--
-- Every new column defaults to 0 / null so existing rows keep working
-- with no backfill, and the forecast engine treats missing values as
-- "not applicable" (no benefit applied, no hint surfaced).

alter table public.tax_profiles
  -- Retirement contributions (item 1)
  add column if not exists solo_401k_contribution_cents bigint not null default 0,
  add column if not exists sep_ira_contribution_cents bigint not null default 0,
  add column if not exists traditional_ira_contribution_cents bigint not null default 0,
  add column if not exists roth_ira_contribution_cents bigint not null default 0,
  add column if not exists hsa_contribution_cents bigint not null default 0,
  -- Self-employed health insurance (item 2)
  add column if not exists se_health_insurance_cents bigint not null default 0,
  -- Capital gains + qualified dividends (item 4)
  add column if not exists long_term_capital_gains_cents bigint not null default 0,
  add column if not exists qualified_dividends_cents bigint not null default 0,
  -- Foreign earned income (item 11)
  add column if not exists foreign_earned_income_cents bigint not null default 0,
  -- Student loan interest (item 6 - partial)
  add column if not exists student_loan_interest_cents bigint not null default 0,
  -- Qualified education expenses for AOTC / Lifetime Learning Credit (item 6)
  add column if not exists qualified_education_expenses_cents bigint not null default 0,
  -- Itemized deduction sub-types (item 5 - we still let the engine use
  -- itemized_total_cents as the working total, but if the user fills
  -- the components we can surface the SALT cap warning and help them
  -- reason about which to claim. NULL means "not broken out".)
  add column if not exists itemized_salt_cents bigint,
  add column if not exists itemized_mortgage_interest_cents bigint,
  add column if not exists itemized_charity_cents bigint,
  add column if not exists itemized_medical_cents bigint,
  -- § 179 expensing election (item 7)
  add column if not exists section_179_expense_cents bigint not null default 0,
  -- Energy + EV credits (item 12)
  add column if not exists residential_energy_credit_cents bigint not null default 0,
  add column if not exists ev_credit_cents bigint not null default 0,
  -- Premium Tax Credit advance payments (item 9 - hint only for now)
  add column if not exists ptc_advance_payments_cents bigint not null default 0;

comment on column public.tax_profiles.solo_401k_contribution_cents is
  'Annual Solo 401(k) employee + employer contributions (combined). Above-the-line deduction. Engine deducts the full amount up to the per-tax-year statutory limit.';
comment on column public.tax_profiles.sep_ira_contribution_cents is
  'Annual SEP-IRA contribution. Above-the-line deduction. Limited to lesser of 25% of net SE earnings or per-year cap.';
comment on column public.tax_profiles.traditional_ira_contribution_cents is
  'Annual Traditional IRA contribution. Above-the-line deduction (deductibility may phase out at higher AGI for active participants in employer plans).';
comment on column public.tax_profiles.roth_ira_contribution_cents is
  'Annual Roth IRA contribution. NOT deductible, but counted toward the Saver''s Credit and toward retirement totals shown in the savings tile.';
comment on column public.tax_profiles.hsa_contribution_cents is
  'Annual HSA contribution. Above-the-line deduction; subject to per-year statutory limits ($4,400 self-only / $8,750 family for 2026).';
comment on column public.tax_profiles.se_health_insurance_cents is
  'Premiums paid for SE health insurance. Above-the-line deduction (limited to SE earnings).';
comment on column public.tax_profiles.long_term_capital_gains_cents is
  'Net long-term capital gains for the year. Taxed at separate 0/15/20% brackets, not ordinary rates.';
comment on column public.tax_profiles.qualified_dividends_cents is
  'Qualified dividends for the year. Taxed at the same 0/15/20% brackets as LTCG.';
comment on column public.tax_profiles.foreign_earned_income_cents is
  'Foreign earned income eligible for the § 911 exclusion (up to $132,900 for 2026).';
comment on column public.tax_profiles.student_loan_interest_cents is
  'Student loan interest paid this year. § 221 above-the-line deduction up to $2,500 with AGI phase-out.';
comment on column public.tax_profiles.qualified_education_expenses_cents is
  'Tuition + qualified fees paid this year. Input for the AOTC / Lifetime Learning Credit eligibility hint.';
comment on column public.tax_profiles.section_179_expense_cents is
  'Cost of business property the taxpayer elects to expense under § 179 (rather than depreciate). 2026 cap is $2,560,000 (OBBBA § 70306).';
comment on column public.tax_profiles.residential_energy_credit_cents is
  'Residential energy efficient property credit (solar, geothermal, wind) claimed this year (§ 25D).';
comment on column public.tax_profiles.ev_credit_cents is
  'Clean vehicle credit claimed this year (§ 30D, § 25E for used).';
comment on column public.tax_profiles.ptc_advance_payments_cents is
  'Premium Tax Credit advance payments received from the marketplace (used for reconciliation hint).';
