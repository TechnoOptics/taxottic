/**
 * 2026 federal tax constants.
 *
 * All amounts are in cents to keep currency math integer-clean.
 *
 * Primary source: IRS Rev. Proc. 2025-32 (released Oct 2025), which
 * publishes the tax-year-2026 inflation adjustments. Several amounts
 * also reflect amendments from the One Big Beautiful Bill Act (OBBBA,
 * Pub. L. 119-21, enacted July 4, 2025); those are flagged inline.
 *
 * Cross-references for the load-bearing items:
 *   - Tax rate tables               : Rev. Proc. 2025-32 § 4.01
 *   - Standard deduction            : § 4.14, increased base from OBBBA § 70102
 *   - AMT exemption + phaseout      : § 4.10, permanence from OBBBA § 70107
 *   - Capital gains breakpoints     : § 4.03
 *   - QBI § 199A thresholds         : § 4.26, $400 minimum from OBBBA § 70105
 *   - § 179 expensing               : § 4.24, raised cap from OBBBA § 70306
 *   - Child Tax Credit              : § 4.05, $2,200 max from OBBBA § 70104
 *   - Foreign earned income excl.   : § 4.39
 *   - HSA / FSA / MSA               : §§ 4.15, 4.28
 *
 * The TCJA-era rates and the higher standard deduction were made
 * PERMANENT by OBBBA so there's no scheduled 2026 cliff back to
 * pre-2018 numbers - 2025 was the last year that risk existed.
 *
 * Items NOT in Rev. Proc. 2025-32 (and so retained from 2025 with a
 * note):
 *   - Social Security wage base     : SSA announces separately each Oct.
 *                                     For 2026 the SSA published $184,500
 *                                     (subject to verification before
 *                                     production deploy).
 *   - Standard mileage rate         : IRS Notice (Dec 2025) sets 2026.
 *                                     Default to 2025's $0.70 until that
 *                                     notice lands; document for follow-up.
 *
 * Like constants-2025.ts, this is a hand-curated table. Maintenance
 * cadence: refresh every late October once the Rev. Proc. for the
 * next tax year is published.
 */

import type { FilingStatus } from "./constants-2025";

export type { FilingStatus };

const cents = (dollars: number) => Math.round(dollars * 100);

// ---------- Federal income tax brackets (Rev. Proc. 2025-32 § 4.01) ----------
//
// OBBBA § 70101 made the seven TCJA rates (10/12/22/24/32/35/37) permanent
// for individual taxpayers, so there is no longer a sunset to plan around.
type Bracket = { rate: number; upTo: number | null };

export const FEDERAL_BRACKETS_2026: Record<FilingStatus, Bracket[]> = {
  single: [
    { rate: 0.1, upTo: cents(12_400) },
    { rate: 0.12, upTo: cents(50_400) },
    { rate: 0.22, upTo: cents(105_700) },
    { rate: 0.24, upTo: cents(201_775) },
    { rate: 0.32, upTo: cents(256_225) },
    { rate: 0.35, upTo: cents(640_600) },
    { rate: 0.37, upTo: null },
  ],
  married_filing_jointly: [
    { rate: 0.1, upTo: cents(24_800) },
    { rate: 0.12, upTo: cents(100_800) },
    { rate: 0.22, upTo: cents(211_400) },
    { rate: 0.24, upTo: cents(403_550) },
    { rate: 0.32, upTo: cents(512_450) },
    { rate: 0.35, upTo: cents(768_700) },
    { rate: 0.37, upTo: null },
  ],
  married_filing_separately: [
    { rate: 0.1, upTo: cents(12_400) },
    { rate: 0.12, upTo: cents(50_400) },
    { rate: 0.22, upTo: cents(105_700) },
    { rate: 0.24, upTo: cents(201_775) },
    { rate: 0.32, upTo: cents(256_225) },
    { rate: 0.35, upTo: cents(384_350) },
    { rate: 0.37, upTo: null },
  ],
  head_of_household: [
    { rate: 0.1, upTo: cents(17_700) },
    { rate: 0.12, upTo: cents(67_450) },
    { rate: 0.22, upTo: cents(105_700) },
    { rate: 0.24, upTo: cents(201_750) },
    { rate: 0.32, upTo: cents(256_200) },
    { rate: 0.35, upTo: cents(640_600) },
    { rate: 0.37, upTo: null },
  ],
  qualifying_widow: [
    // Surviving spouse files using the MFJ table per § 1(j)(2)(A).
    { rate: 0.1, upTo: cents(24_800) },
    { rate: 0.12, upTo: cents(100_800) },
    { rate: 0.22, upTo: cents(211_400) },
    { rate: 0.24, upTo: cents(403_550) },
    { rate: 0.32, upTo: cents(512_450) },
    { rate: 0.35, upTo: cents(768_700) },
    { rate: 0.37, upTo: null },
  ],
};

// ---------- Standard deduction (§ 4.14; OBBBA § 70102) ----------
//
// OBBBA raised the base amounts on top of making the TCJA increases
// permanent. The 2025 base was $15,750 / $23,625 / $31,500; for 2026
// the inflation-adjusted figures are below.
export const STANDARD_DEDUCTION_2026: Record<FilingStatus, number> = {
  single: cents(16_100),
  married_filing_jointly: cents(32_200),
  married_filing_separately: cents(16_100),
  head_of_household: cents(24_150),
  qualifying_widow: cents(32_200),
};

// Aged (65+) or blind additional standard deduction (§ 63(f) via § 4.14(3)).
// "Single" applies to single filers and HoH; "married" applies to MFJ/MFS/SS.
export const ADDITIONAL_STD_DEDUCTION_2026 = {
  single: cents(2_050),
  married: cents(1_650),
};

// ---------- Self-employment tax (FICA/Medicare on SE income) ----------
//
// Rates are statutory, not annually adjusted. The Social Security wage
// base IS adjusted annually but by the SSA (not the IRS), and is
// published outside Rev. Proc. 2025-32. SSA's October 2025 announcement
// set the 2026 wage base at $184,500 - verify against
// https://www.ssa.gov/oact/cola/cbb.html before each tax season.
export const SE_TAX_2026 = {
  socialSecurityRate: 0.124,
  medicareRate: 0.029,
  additionalMedicareRate: 0.009,
  netEarningsFactor: 0.9235, // 1 - 7.65%
  socialSecurityWageBase: cents(184_500), // 2026 SSA-published wage base
  // Additional 0.9% Medicare surcharge thresholds (§ 1401(b)). These
  // are statutory and NOT indexed; they have stayed at $200k / $250k /
  // $125k since 2013.
  additionalMedicareThreshold: {
    single: cents(200_000),
    married_filing_jointly: cents(250_000),
    married_filing_separately: cents(125_000),
    head_of_household: cents(200_000),
    qualifying_widow: cents(250_000),
  } as Record<FilingStatus, number>,
};

// ---------- QBI § 199A (Rev. Proc. 2025-32 § 4.26; OBBBA § 70105) ----------
//
// OBBBA added a $400 minimum deduction AND a $1,000 minimum QBI to be
// eligible. Both surface in the forecast follow-up; the constants are
// captured here for the eventual wiring.
export const QBI_2026 = {
  rate: 0.2,
  thresholdBelow: {
    single: cents(201_750),
    married_filing_jointly: cents(403_500),
    married_filing_separately: cents(201_775),
    head_of_household: cents(201_750),
    qualifying_widow: cents(403_500),
  } as Record<FilingStatus, number>,
  // OBBBA § 70105 amendments to § 199A(i), effective for TY 2026.
  // These are inflation-adjusted for taxable years after 2026.
  obbbaMinimumDeductionCents: cents(400),
  obbbaMinimumQbiToQualifyCents: cents(1_000),
};

// ---------- Mileage rate (IRS Notice, separate annual release) ----------
//
// The 2026 standard mileage rate is announced by the IRS in December
// 2025 (typically as a "Notice 2025-XX"). At time of writing the
// 2026 notice is not yet published; we retain the 2025 value of
// $0.70/mile and document for refresh.
export const MILEAGE_RATE_2026_PER_MILE_CENTS = 70;

// ---------- Child Tax Credit (§ 4.05; OBBBA § 70104) ----------
//
// OBBBA increased the maximum credit to $2,200 for 2025+ and made the
// expanded CTC permanent. The refundable portion under § 24(d)(1)(A)
// is $1,700 for 2026.
export const CHILD_TAX_CREDIT_2026 = {
  ctcPerChildCents: cents(2_200),
  odcPerOtherCents: cents(500),
  refundablePerChildCents: cents(1_700),
  // Phase-out thresholds are unchanged by OBBBA (still $200k single /
  // $400k MFJ). Phase-out is $50 per $1,000 of AGI above threshold.
  phaseOutStart: {
    single: cents(200_000),
    married_filing_jointly: cents(400_000),
    married_filing_separately: cents(200_000),
    head_of_household: cents(200_000),
    qualifying_widow: cents(400_000),
  } as Record<FilingStatus, number>,
  phaseOutReductionPer1000: cents(50),
};

// ---------- Net Investment Income Tax (§ 1411) ----------
//
// NIIT thresholds are statutory and not inflation-adjusted; they have
// stayed at the same dollar amounts since enactment. Mirrors 2025.
export const NIIT_2026 = {
  rate: 0.038,
  threshold: {
    single: cents(200_000),
    married_filing_jointly: cents(250_000),
    married_filing_separately: cents(125_000),
    head_of_household: cents(200_000),
    qualifying_widow: cents(250_000),
  } as Record<FilingStatus, number>,
};

// ---------- Alternative Minimum Tax (§ 4.10; OBBBA § 70107) ----------
//
// OBBBA made the TCJA-era AMT exemption increases permanent. The
// $1,000,000 phase-out trigger for joint filers is now frozen and
// NOT inflation-adjusted before 2027.
export const AMT_2026 = {
  exemption: {
    single: cents(90_100),
    married_filing_jointly: cents(140_200),
    married_filing_separately: cents(70_100),
    head_of_household: cents(90_100),
    qualifying_widow: cents(140_200),
  } as Record<FilingStatus, number>,
  // Excess taxable income above which the 28% rate applies (§ 55(b)(1)).
  twentyEightPercentBreakpoint: {
    single: cents(244_500),
    married_filing_jointly: cents(244_500),
    married_filing_separately: cents(122_250),
    head_of_household: cents(244_500),
    qualifying_widow: cents(244_500),
  } as Record<FilingStatus, number>,
  // Phaseout thresholds (§ 55(d)(2)). The "single" phaseout START for
  // MFJ is statutory at $1,000,000 (NOT adjusted before 2027 per OBBBA);
  // the complete-phaseout amount is inflation-adjusted normally.
  phaseoutStart: {
    single: cents(500_000),
    married_filing_jointly: cents(1_000_000),
    married_filing_separately: cents(500_000),
    head_of_household: cents(500_000),
    qualifying_widow: cents(1_000_000),
  } as Record<FilingStatus, number>,
  phaseoutComplete: {
    single: cents(680_200),
    married_filing_jointly: cents(1_280_400),
    married_filing_separately: cents(640_200),
    head_of_household: cents(680_200),
    qualifying_widow: cents(1_280_400),
  } as Record<FilingStatus, number>,
};

// ---------- Capital gains breakpoints (§ 4.03) ----------
//
// The 0% / 15% / 20% rate breakpoints for long-term capital gains and
// qualified dividends.
export const CAPITAL_GAINS_2026 = {
  zeroRateUpTo: {
    single: cents(49_450),
    married_filing_jointly: cents(98_900),
    married_filing_separately: cents(49_450),
    head_of_household: cents(66_200),
    qualifying_widow: cents(98_900),
  } as Record<FilingStatus, number>,
  fifteenRateUpTo: {
    single: cents(545_500),
    married_filing_jointly: cents(613_700),
    married_filing_separately: cents(306_850),
    head_of_household: cents(579_600),
    qualifying_widow: cents(613_700),
  } as Record<FilingStatus, number>,
  // Above the 15% breakpoint, 20% applies.
};

// ---------- § 179 expensing (§ 4.24; OBBBA § 70306) ----------
//
// OBBBA more than doubled the expensing cap and phase-out. 2025 was
// $1,250,000 cap / $3,130,000 phase-out start; 2026 is below. Effective
// for property placed in service in taxable years beginning after
// Dec 31, 2024.
export const SECTION_179_2026 = {
  expensingCapCents: cents(2_560_000),
  phaseOutStartCents: cents(4_090_000),
  suvCapCents: cents(32_000),
};

// ---------- HSA / FSA / MSA (§ 4.15 cafeteria, § 4.28 MSA) ----------
export const HEALTH_ACCOUNT_LIMITS_2026 = {
  fsaSalaryReduction: cents(3_400),
  fsaCarryoverMax: cents(680),
  msaSelfOnlyMinDeductible: cents(2_900),
  msaSelfOnlyMaxDeductible: cents(4_400),
  msaSelfOnlyOOPMax: cents(5_850),
  msaFamilyMinDeductible: cents(5_850),
  msaFamilyMaxDeductible: cents(8_750),
  msaFamilyOOPMax: cents(10_700),
};

// ---------- Foreign earned income exclusion (§ 4.39) ----------
export const FOREIGN_EARNED_INCOME_EXCLUSION_2026 = cents(132_900);

// ---------- Estate & gift (§§ 4.42; OBBBA § 70106) ----------
//
// OBBBA raised the basic exclusion to $15M for calendar year 2026.
// Annual gift exclusion unchanged from 2025 at $19,000.
export const ESTATE_GIFT_2026 = {
  basicExclusionCents: cents(15_000_000),
  annualGiftExclusionCents: cents(19_000),
  nonCitizenSpouseGiftCents: cents(194_000),
};

// ---------- Educator expense (§ 4.12) ----------
export const EDUCATOR_EXPENSE_DEDUCTION_2026 = cents(350);

// ---------- § 6041 information-reporting threshold (OBBBA § 70433) ----------
//
// Raises the long-standing $600 threshold for 1099-NEC / 1099-MISC
// reporting to $2,000 for payments made AFTER December 31, 2025.
// Surfaces in the forecast as "you only need to send 1099s above
// $2,000" guidance. Inflation-adjusted starting 2027.
export const INFO_REPORTING_THRESHOLD_2026_CENTS = cents(2_000);

// ---------- Quarterly due dates ----------
//
// Same statutory pattern; Q4 shifts to mid-Jan of the following year.
// Federal-holiday/weekend adjustments are a UI concern.
export const QUARTERLY_DUE_DATES_2026: ReadonlyArray<{
  quarter: 1 | 2 | 3 | 4;
  month: number;
  day: number;
  inFollowingYear: boolean;
}> = [
  { quarter: 1, month: 4, day: 15, inFollowingYear: false },
  { quarter: 2, month: 6, day: 15, inFollowingYear: false },
  { quarter: 3, month: 9, day: 15, inFollowingYear: false },
  { quarter: 4, month: 1, day: 15, inFollowingYear: true },
];

// ---------- Underpayment-penalty safe harbor ----------
//
// Same statutory thresholds as 2025; unchanged by OBBBA.
export const UNDERPAYMENT_SAFE_HARBOR_2026 = {
  currentYearShare: 0.9,
  priorYearShare: 1.0,
  priorYearShareHighIncome: 1.1,
  priorYearAgiThreshold: cents(150_000),
};
