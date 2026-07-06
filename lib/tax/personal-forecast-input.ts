import type { ForecastInput } from "@/lib/tax/forecast";
import type { FilingStatus } from "@/lib/tax/constants-2025";
import {
  sumPersonalExpenses,
  type PersonalDeductionField,
} from "@/lib/tax/personal-expense-categories";

/** The tax_profiles row shape the personal forecast reads. Loose by design
 *  (the table has many nullable columns); every field is coalesced below. */
type TaxProfileRow = Record<string, unknown> & {
  filing_status: string;
  state_code: string | null;
  age: number | null;
  is_blind: boolean | null;
  itemize: boolean | null;
  dependents: number | null;
};

function n(row: TaxProfileRow, key: string): number | null {
  const v = row[key];
  return typeof v === "number" ? v : null;
}
function b(row: TaxProfileRow, key: string): boolean {
  return row[key] === true;
}

/**
 * Assemble the personal (individual-side) ForecastInput from a tax_profiles
 * row and the user's tracked personal expenses. Shared by the personal
 * forecast page and the annual export so both compute the exact same numbers
 * (item 16). When the user has logged expenses in a deduction category, that
 * tracked total overrides the typed profile figure (override, not sum, so no
 * double-counting).
 */
export function buildPersonalForecastInput(
  taxProfile: TaxProfileRow,
  trackedRows: { category: string; amount_cents: number }[],
  taxYear: number,
): ForecastInput {
  const tracked: Partial<Record<PersonalDeductionField, number>> =
    sumPersonalExpenses(trackedRows);

  return {
    // Items 14-16: individual side. Scope explicitly to "personal" so only
    // individual deductions and credits apply and no business-only treatment
    // can leak in. The business side sets scope "business" (item 17).
    scope: "personal",
    taxYear,
    filingStatus: taxProfile.filing_status as FilingStatus,
    stateCode: taxProfile.state_code,
    age: taxProfile.age,
    isBlind: taxProfile.is_blind ?? false,
    itemize: taxProfile.itemize ?? false,
    dependents: taxProfile.dependents ?? 0,
    dependentsUnder17: n(taxProfile, "dependents_under_17") ?? 0,
    spouseIncomeCents: n(taxProfile, "spouse_income_cents") ?? 0,
    estimatedPaymentsCents: n(taxProfile, "estimated_payments_cents") ?? 0,
    ownerW2WagesCents: n(taxProfile, "owner_w2_wages_cents") ?? 0,
    ownerW2WithheldCents: n(taxProfile, "owner_w2_withheld_cents") ?? 0,
    ownerW2SsWagesCents: n(taxProfile, "owner_w2_ss_wages_cents") ?? 0,
    spouseW2WagesCents: n(taxProfile, "spouse_w2_wages_cents") ?? 0,
    spouseW2WithheldCents: n(taxProfile, "spouse_w2_withheld_cents") ?? 0,
    spouseW2SsWagesCents: n(taxProfile, "spouse_w2_ss_wages_cents") ?? 0,
    entityType: "self_employed_1099",
    ytdIncomeCents: 0,
    ytdBusinessExpensesCents: 0,
    ytdMealsCents: 0,
    ytdAboveTheLineCents: 0,
    ytdItemizedCents: n(taxProfile, "itemized_total_cents") ?? 0,
    autoMileageCents: 0,
    autoHomeOfficeCents: 0,
    monthsEntered: 12,
    ytdInvestmentIncomeCents: 0,
    retirementSolo401kCents: n(taxProfile, "solo_401k_contribution_cents") ?? 0,
    retirementSepIraCents: n(taxProfile, "sep_ira_contribution_cents") ?? 0,
    retirementTraditionalIraCents:
      n(taxProfile, "traditional_ira_contribution_cents") ?? 0,
    retirementRothIraCents: n(taxProfile, "roth_ira_contribution_cents") ?? 0,
    retirementHsaCents: n(taxProfile, "hsa_contribution_cents") ?? 0,
    selfEmployedHealthInsuranceCents:
      n(taxProfile, "se_health_insurance_cents") ?? 0,
    longTermCapitalGainsCents: n(taxProfile, "long_term_capital_gains_cents") ?? 0,
    qualifiedDividendsCents: n(taxProfile, "qualified_dividends_cents") ?? 0,
    foreignEarnedIncomeCents: n(taxProfile, "foreign_earned_income_cents") ?? 0,
    studentLoanInterestCents:
      tracked.studentLoanInterestCents ??
      n(taxProfile, "student_loan_interest_cents") ??
      0,
    qualifiedEducationExpensesCents:
      tracked.qualifiedEducationExpensesCents ??
      n(taxProfile, "qualified_education_expenses_cents") ??
      0,
    claimAotc: b(taxProfile, "claim_aotc"),
    itemizedSaltCents:
      tracked.itemizedSaltCents ??
      n(taxProfile, "itemized_salt_cents") ??
      undefined,
    itemizedMortgageInterestCents:
      tracked.itemizedMortgageInterestCents ??
      n(taxProfile, "itemized_mortgage_interest_cents") ??
      undefined,
    itemizedCharityCents:
      tracked.itemizedCharityCents ??
      n(taxProfile, "itemized_charity_cents") ??
      undefined,
    itemizedMedicalCents:
      tracked.itemizedMedicalCents ??
      n(taxProfile, "itemized_medical_cents") ??
      undefined,
    section179ExpenseCents: n(taxProfile, "section_179_expense_cents") ?? 0,
    residentialEnergyCreditCents:
      n(taxProfile, "residential_energy_credit_cents") ?? 0,
    evCreditCents: n(taxProfile, "ev_credit_cents") ?? 0,
    ptcAdvancePaymentsCents: n(taxProfile, "ptc_advance_payments_cents") ?? 0,
  };
}
