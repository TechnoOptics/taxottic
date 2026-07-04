/**
 * 2025 federal tax constants.
 *
 * All amounts are in cents to keep currency math integer-clean.
 * Source: IRS Rev. Proc. 2024-40 + Pub 15-T + 2025 inflation adjustments.
 *
 * NOTE: this is a hand-curated table. Update annually around late October when
 * the IRS publishes the next year's adjustments. Eventually this gets pulled
 * from a tax-data API; for now it lives in code so the forecast can run
 * offline and we control the source of truth.
 */

export type FilingStatus =
  | "single"
  | "married_filing_jointly"
  | "married_filing_separately"
  | "head_of_household"
  | "qualifying_widow";

const cents = (dollars: number) => Math.round(dollars * 100);

// Federal income tax brackets - marginal rates and the upper bound (in cents)
// at which each bracket ends. The last bracket has no upper bound.
type Bracket = { rate: number; upTo: number | null };

export const FEDERAL_BRACKETS_2025: Record<FilingStatus, Bracket[]> = {
  single: [
    { rate: 0.1, upTo: cents(11_925) },
    { rate: 0.12, upTo: cents(48_475) },
    { rate: 0.22, upTo: cents(103_350) },
    { rate: 0.24, upTo: cents(197_300) },
    { rate: 0.32, upTo: cents(250_525) },
    { rate: 0.35, upTo: cents(626_350) },
    { rate: 0.37, upTo: null },
  ],
  married_filing_jointly: [
    { rate: 0.1, upTo: cents(23_850) },
    { rate: 0.12, upTo: cents(96_950) },
    { rate: 0.22, upTo: cents(206_700) },
    { rate: 0.24, upTo: cents(394_600) },
    { rate: 0.32, upTo: cents(501_050) },
    { rate: 0.35, upTo: cents(751_600) },
    { rate: 0.37, upTo: null },
  ],
  married_filing_separately: [
    { rate: 0.1, upTo: cents(11_925) },
    { rate: 0.12, upTo: cents(48_475) },
    { rate: 0.22, upTo: cents(103_350) },
    { rate: 0.24, upTo: cents(197_300) },
    { rate: 0.32, upTo: cents(250_525) },
    { rate: 0.35, upTo: cents(375_800) },
    { rate: 0.37, upTo: null },
  ],
  head_of_household: [
    { rate: 0.1, upTo: cents(17_000) },
    { rate: 0.12, upTo: cents(64_850) },
    { rate: 0.22, upTo: cents(103_350) },
    { rate: 0.24, upTo: cents(197_300) },
    { rate: 0.32, upTo: cents(250_500) },
    { rate: 0.35, upTo: cents(626_350) },
    { rate: 0.37, upTo: null },
  ],
  qualifying_widow: [
    { rate: 0.1, upTo: cents(23_850) },
    { rate: 0.12, upTo: cents(96_950) },
    { rate: 0.22, upTo: cents(206_700) },
    { rate: 0.24, upTo: cents(394_600) },
    { rate: 0.32, upTo: cents(501_050) },
    { rate: 0.35, upTo: cents(751_600) },
    { rate: 0.37, upTo: null },
  ],
};

export const STANDARD_DEDUCTION_2025: Record<FilingStatus, number> = {
  single: cents(15_000),
  married_filing_jointly: cents(30_000),
  married_filing_separately: cents(15_000),
  head_of_household: cents(22_500),
  qualifying_widow: cents(30_000),
};

// Additional standard deduction for age 65+ or blind (per condition).
export const ADDITIONAL_STD_DEDUCTION_2025 = {
  single: cents(2_000),
  married: cents(1_600),
};

// Self-employment tax: 15.3% on 92.35% of net SE earnings.
// Social Security portion (12.4%) caps at the wage base; Medicare (2.9%) has no cap.
// Additional 0.9% Medicare surcharge on SE income above the threshold.
export const SE_TAX_2025 = {
  socialSecurityRate: 0.124,
  medicareRate: 0.029,
  additionalMedicareRate: 0.009,
  netEarningsFactor: 0.9235, // 1 - 7.65%
  socialSecurityWageBase: cents(176_100), // 2025 SS wage base
  additionalMedicareThreshold: {
    single: cents(200_000),
    married_filing_jointly: cents(250_000),
    married_filing_separately: cents(125_000),
    head_of_household: cents(200_000),
    qualifying_widow: cents(250_000),
  } as Record<FilingStatus, number>,
};

// QBI (Qualified Business Income) deduction §199A: 20% of qualified business
// income, with phase-out thresholds and SSTB rules above the threshold.
// Below the threshold the math is straightforward. Above it, it gets complex
// (W-2 wage / qualified property tests, SSTB phase-outs). For Phase 2 we apply
// the simple 20% below threshold and disable above it; users above the threshold
// should consult a CPA - we surface that in the UI.
export const QBI_2025 = {
  rate: 0.2,
  thresholdBelow: {
    single: cents(197_300),
    married_filing_jointly: cents(394_600),
    married_filing_separately: cents(197_300),
    head_of_household: cents(197_300),
    qualifying_widow: cents(394_600),
  } as Record<FilingStatus, number>,
};

// Standard mileage rate (business). 2025: $0.70 per mile.
// Source: IRS Notice 2025-3 (announced Dec 2024).
export const MILEAGE_RATE_2025_PER_MILE_CENTS = 70;

// Child Tax Credit (CTC) and Credit for Other Dependents (ODC).
// 2025: $2,000 per qualifying child under 17 (CTC), $500 per other dependent
// (ODC). Both phase out by $50 per $1,000 of AGI over the threshold.
// Source: IRC §24, Rev. Proc. 2024-40.
export const CHILD_TAX_CREDIT_2025 = {
  ctcPerChildCents: cents(2_000),
  odcPerOtherCents: cents(500),
  // Phase-out begins above these AGI thresholds. Reduction is $50 per
  // $1,000 (or fraction) of AGI above the threshold, applied to the total
  // credit (CTC + ODC combined).
  phaseOutStart: {
    single: cents(200_000),
    married_filing_jointly: cents(400_000),
    married_filing_separately: cents(200_000),
    head_of_household: cents(200_000),
    qualifying_widow: cents(400_000),
  } as Record<FilingStatus, number>,
  phaseOutReductionPer1000: cents(50),
};

// Very simplified state tax estimates - flat rate by state.
// This is a placeholder until we wire a real bracket lookup or an API.
// Effective rates are rough averages; the UI labels this as an estimate.
export const STATE_FLAT_RATES_2025: Record<string, number> = {
  AL: 0.05,
  AK: 0,
  AZ: 0.025,
  AR: 0.039,
  CA: 0.07,   // average effective; real CA brackets go much higher
  CO: 0.044,
  CT: 0.055,
  DE: 0.054,
  DC: 0.066,
  FL: 0,
  GA: 0.0539,
  HI: 0.07,
  ID: 0.058,
  IL: 0.0495,
  IN: 0.03,
  IA: 0.038,
  KS: 0.054,
  KY: 0.04,
  LA: 0.03,
  ME: 0.058,
  MD: 0.0475,
  MA: 0.05,
  MI: 0.0425,
  MN: 0.068,
  MS: 0.044,
  MO: 0.047,
  MT: 0.054,
  NE: 0.0464,
  NV: 0,
  NH: 0,      // wages 0%, dividends/interest taxed (not modeled)
  NJ: 0.055,
  NM: 0.049,
  NY: 0.06,
  NC: 0.0425,
  ND: 0.025,
  OH: 0.0375,
  OK: 0.0475,
  OR: 0.0875,
  PA: 0.0307,
  RI: 0.0475,
  SC: 0.0625,
  SD: 0,
  TN: 0,
  TX: 0,
  UT: 0.0455,
  VT: 0.066,
  VA: 0.055,
  WA: 0,
  WV: 0.0482,
  WI: 0.053,
  WY: 0,
  PR: 0,      // territory - federal rules differ; treat as 0 for now
  VI: 0,
  GU: 0,
  AS: 0,
  MP: 0,
};

export function stateRate(stateCode: string | null | undefined): number {
  if (!stateCode) return 0;
  return STATE_FLAT_RATES_2025[stateCode.toUpperCase()] ?? 0;
}

// Net Investment Income Tax (NIIT) - 3.8% surtax on the lesser of
// (a) net investment income or (b) modified AGI above the threshold.
// IRC §1411. Applies to dividends, interest, capital gains, and
// passive-activity rental income.
export const NIIT_2025 = {
  rate: 0.038,
  threshold: {
    single: cents(200_000),
    married_filing_jointly: cents(250_000),
    married_filing_separately: cents(125_000),
    head_of_household: cents(200_000),
    qualifying_widow: cents(250_000),
  } as Record<FilingStatus, number>,
};

// Federal estimated-tax due dates for tax-year 2025. Q4 lands on
// Jan 15 of the FOLLOWING calendar year. The IRS shifts a date to the
// next business day if it falls on a weekend or federal holiday;
// shifting is a UI concern (we annotate the underlying calendar date
// here and let the formatting layer adjust if needed).
export const QUARTERLY_DUE_DATES_2025: ReadonlyArray<{
  quarter: 1 | 2 | 3 | 4;
  /** Month index 1-12. */
  month: number;
  /** Day of month. */
  day: number;
  /** True for Q4, falls in the year after the tax year. */
  inFollowingYear: boolean;
}> = [
  { quarter: 1, month: 4, day: 15, inFollowingYear: false },
  { quarter: 2, month: 6, day: 15, inFollowingYear: false },
  { quarter: 3, month: 9, day: 15, inFollowingYear: false },
  { quarter: 4, month: 1, day: 15, inFollowingYear: true },
];

// Safe-harbor for avoiding the underpayment-penalty: pay at least
// the LESSER of (a) 90% of this year's total tax or (b) 100% of
// last year's tax (110% if prior-year AGI > $150K). We don't have
// reliable last-year numbers for new users, so we lean on (a), the
// 90%-of-current-year rule, and surface a hint when withholding +
// estimates fall short.
export const UNDERPAYMENT_SAFE_HARBOR_2025 = {
  currentYearShare: 0.9,
  priorYearShare: 1.0,
  priorYearShareHighIncome: 1.1,
  priorYearAgiThreshold: cents(150_000),
};
