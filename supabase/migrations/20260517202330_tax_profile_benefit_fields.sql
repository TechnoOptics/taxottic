-- Recovered 20260517202330 (tax_profile_benefit_fields) from supabase_migrations.schema_migrations.
-- Applied out-of-band via the Supabase MCP/SQL editor and never
-- committed. Statements are verbatim from the history table, not
-- reconstructed from the schema. See docs/migration-history-state.md.

alter table public.tax_profiles
  add column if not exists solo_401k_contribution_cents bigint not null default 0,
  add column if not exists sep_ira_contribution_cents bigint not null default 0,
  add column if not exists traditional_ira_contribution_cents bigint not null default 0,
  add column if not exists roth_ira_contribution_cents bigint not null default 0,
  add column if not exists hsa_contribution_cents bigint not null default 0,
  add column if not exists se_health_insurance_cents bigint not null default 0,
  add column if not exists long_term_capital_gains_cents bigint not null default 0,
  add column if not exists qualified_dividends_cents bigint not null default 0,
  add column if not exists foreign_earned_income_cents bigint not null default 0,
  add column if not exists student_loan_interest_cents bigint not null default 0,
  add column if not exists qualified_education_expenses_cents bigint not null default 0,
  add column if not exists claim_aotc boolean not null default false,
  add column if not exists itemized_salt_cents bigint,
  add column if not exists itemized_mortgage_interest_cents bigint,
  add column if not exists itemized_charity_cents bigint,
  add column if not exists itemized_medical_cents bigint,
  add column if not exists section_179_expense_cents bigint not null default 0,
  add column if not exists residential_energy_credit_cents bigint not null default 0,
  add column if not exists ev_credit_cents bigint not null default 0,
  add column if not exists ptc_advance_payments_cents bigint not null default 0;

comment on column public.tax_profiles.solo_401k_contribution_cents is
  'Annual Solo 401(k) employee + employer contributions (combined). Above-the-line deduction. Engine deducts the full amount up to the per-tax-year statutory limit.';
comment on column public.tax_profiles.ptc_advance_payments_cents is
  'Premium Tax Credit advance payments received from the marketplace (used for reconciliation hint).';
