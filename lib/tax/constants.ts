/**
 * Tax-year-aware selector for federal-tax constants.
 *
 * The forecast engine takes `input.taxYear` and needs to look up the
 * right bracket table, standard deduction, QBI threshold, etc. for
 * that year. Up to TY 2025 we hard-imported constants-2025.ts
 * everywhere; that worked while only one year mattered but breaks
 * once 2026 ships. This module bundles the per-year constants behind
 * one selector so callers don't have to switch on year themselves.
 *
 * Adding a new tax year:
 *   1. Write lib/tax/constants-<year>.ts with the same exports the
 *      bundle type below expects.
 *   2. Add a case in getTaxYearConstants below.
 *   3. Decide what to do for "unknown future year" - currently we
 *      fall through to the most-recent year we have so a forecast
 *      run before the IRS publishes that year's numbers still works
 *      with the prior year's brackets (the engine surfaces this via
 *      a hint - see lib/tax/forecast.ts).
 *
 * The "_2025" / "_2026" suffixed constants in their original files
 * are retained as direct exports so existing callers that haven't
 * migrated to the selector keep compiling. Migrate them at leisure;
 * the bundle is the new path.
 */

import type { FilingStatus } from "./constants-2025";
import {
  ADDITIONAL_STD_DEDUCTION_2025,
  CHILD_TAX_CREDIT_2025,
  FEDERAL_BRACKETS_2025,
  MILEAGE_RATE_2025_PER_MILE_CENTS,
  NIIT_2025,
  QBI_2025,
  SE_TAX_2025,
  STANDARD_DEDUCTION_2025,
  UNDERPAYMENT_SAFE_HARBOR_2025,
} from "./constants-2025";
import {
  ADDITIONAL_STD_DEDUCTION_2026,
  CHILD_TAX_CREDIT_2026,
  FEDERAL_BRACKETS_2026,
  MILEAGE_RATE_2026_PER_MILE_CENTS,
  NIIT_2026,
  QBI_2026,
  SE_TAX_2026,
  STANDARD_DEDUCTION_2026,
  UNDERPAYMENT_SAFE_HARBOR_2026,
} from "./constants-2026";

export type Bracket = { rate: number; upTo: number | null };

export type TaxYearConstants = {
  /** The year this bundle represents (so consumers can show "applying
   *  YYYY brackets" copy without inferring). */
  year: number;
  FEDERAL_BRACKETS: Record<FilingStatus, Bracket[]>;
  STANDARD_DEDUCTION: Record<FilingStatus, number>;
  ADDITIONAL_STD_DEDUCTION: { single: number; married: number };
  SE_TAX: {
    socialSecurityRate: number;
    medicareRate: number;
    additionalMedicareRate: number;
    netEarningsFactor: number;
    socialSecurityWageBase: number;
    additionalMedicareThreshold: Record<FilingStatus, number>;
  };
  QBI: {
    rate: number;
    thresholdBelow: Record<FilingStatus, number>;
    /**
     * OBBBA § 70105 added a minimum deduction of $400 for TY 2026+
     * provided the taxpayer has at least the qualifying QBI floor
     * (typically $1,000). Optional so 2025 and earlier years - which
     * don't have this rule - leave both undefined and the engine
     * skips the minimum-deduction logic.
     */
    obbbaMinimumDeductionCents?: number;
    obbbaMinimumQbiToQualifyCents?: number;
  };
  MILEAGE_RATE_PER_MILE_CENTS: number;
  /**
   * True when the per-year IRS Notice that sets the mileage rate
   * hasn't been published yet and the bundle is using the prior
   * year's rate as a placeholder. The forecast engine surfaces this
   * in its assumptions output so users know the cents-per-mile they
   * see is provisional.
   */
  isMileageRateProvisional: boolean;
  /**
   * Aggregate-payment threshold above which a business must file
   * 1099-NEC / 1099-MISC for a vendor (IRC § 6041). OBBBA § 70433
   * raised this from $600 to $2,000 effective for payments made
   * after Dec 31 2025. The forecast surfaces a heads-up hint to
   * self-employed filers in the relevant tax year.
   */
  INFO_REPORTING_THRESHOLD_CENTS: number;
  CHILD_TAX_CREDIT: {
    ctcPerChildCents: number;
    odcPerOtherCents: number;
    phaseOutStart: Record<FilingStatus, number>;
    phaseOutReductionPer1000: number;
  };
  NIIT: {
    rate: number;
    threshold: Record<FilingStatus, number>;
  };
  UNDERPAYMENT_SAFE_HARBOR: {
    currentYearShare: number;
    priorYearShare: number;
    priorYearShareHighIncome: number;
    priorYearAgiThreshold: number;
  };
  /** True if the caller asked for a year we don't have an exact
   *  table for and we fell back to a different year. Consumers may
   *  want to show a banner ("we don't yet have YYYY brackets;
   *  forecasting with the most recent published year"). */
  isFallback: boolean;
};

const BUNDLE_2025: TaxYearConstants = {
  year: 2025,
  FEDERAL_BRACKETS: FEDERAL_BRACKETS_2025,
  STANDARD_DEDUCTION: STANDARD_DEDUCTION_2025,
  ADDITIONAL_STD_DEDUCTION: ADDITIONAL_STD_DEDUCTION_2025,
  SE_TAX: SE_TAX_2025,
  QBI: QBI_2025,
  MILEAGE_RATE_PER_MILE_CENTS: MILEAGE_RATE_2025_PER_MILE_CENTS,
  // The 2025 IRS Notice was published (Notice 2025-3) before the
  // tax year opened, so the rate isn't provisional.
  isMileageRateProvisional: false,
  // The pre-OBBBA $600 threshold is unchanged for 2025 payments.
  INFO_REPORTING_THRESHOLD_CENTS: 600 * 100,
  CHILD_TAX_CREDIT: CHILD_TAX_CREDIT_2025,
  NIIT: NIIT_2025,
  UNDERPAYMENT_SAFE_HARBOR: UNDERPAYMENT_SAFE_HARBOR_2025,
  isFallback: false,
};

const BUNDLE_2026: TaxYearConstants = {
  year: 2026,
  FEDERAL_BRACKETS: FEDERAL_BRACKETS_2026,
  STANDARD_DEDUCTION: STANDARD_DEDUCTION_2026,
  ADDITIONAL_STD_DEDUCTION: ADDITIONAL_STD_DEDUCTION_2026,
  // 2026 SE_TAX uses the 2026 SSA wage base ($184,500); the other
  // fields are statutory and identical to 2025.
  SE_TAX: SE_TAX_2026,
  // OBBBA § 70105 added a minimum deduction and a minimum-QBI floor
  // for TY 2026+. Carrying both through the bundle so the engine can
  // apply the rule without importing the year-specific module.
  QBI: {
    rate: QBI_2026.rate,
    thresholdBelow: QBI_2026.thresholdBelow,
    obbbaMinimumDeductionCents: QBI_2026.obbbaMinimumDeductionCents,
    obbbaMinimumQbiToQualifyCents: QBI_2026.obbbaMinimumQbiToQualifyCents,
  },
  MILEAGE_RATE_PER_MILE_CENTS: MILEAGE_RATE_2026_PER_MILE_CENTS,
  // The 2026 IRS Notice setting the standard mileage rate hadn't
  // been released when this bundle was built; the rate above falls
  // back to the 2025 value. The forecast engine surfaces a
  // "provisional rate" assumption when this flag is true; flip to
  // false (and update MILEAGE_RATE_2026_PER_MILE_CENTS) once the
  // 2026 Notice publishes (typically late December 2025 / early
  // January 2026).
  isMileageRateProvisional: true,
  // OBBBA § 70433: raised § 6041 reporting threshold from $600 to
  // $2,000 for payments made after Dec 31 2025.
  INFO_REPORTING_THRESHOLD_CENTS: 2000 * 100,
  // Bundle only ships the fields the forecast engine consumes today;
  // the full 2026 CTC export carries `refundablePerChildCents` for
  // future wiring.
  CHILD_TAX_CREDIT: {
    ctcPerChildCents: CHILD_TAX_CREDIT_2026.ctcPerChildCents,
    odcPerOtherCents: CHILD_TAX_CREDIT_2026.odcPerOtherCents,
    phaseOutStart: CHILD_TAX_CREDIT_2026.phaseOutStart,
    phaseOutReductionPer1000: CHILD_TAX_CREDIT_2026.phaseOutReductionPer1000,
  },
  NIIT: NIIT_2026,
  UNDERPAYMENT_SAFE_HARBOR: UNDERPAYMENT_SAFE_HARBOR_2026,
  isFallback: false,
};

/**
 * Latest published year. Future-year requests fall back to this.
 * Bump this when a new constants-<year>.ts lands.
 */
const LATEST_PUBLISHED_YEAR = 2026;

/**
 * Pick the right per-year bundle for a forecast. Future years
 * (e.g. a request for 2027 before the IRS publishes 2027 numbers)
 * fall back to the most recent published bundle with isFallback set
 * to true so the UI can surface a "still using 2026 brackets" note.
 * Past years older than what we maintain (currently 2025) also fall
 * back, with the same flag - we don't intend to maintain a deep
 * historical table for the forecaster.
 */
export function getTaxYearConstants(taxYear: number): TaxYearConstants {
  if (taxYear === 2025) return BUNDLE_2025;
  if (taxYear === 2026) return BUNDLE_2026;
  // Fall back to the most recent published year with the flag set so
  // callers can surface a disclaimer.
  if (taxYear > LATEST_PUBLISHED_YEAR) {
    return { ...BUNDLE_2026, isFallback: true };
  }
  // Pre-2025 request - use 2025 with the flag set. We don't model
  // pre-OBBBA brackets and the forecast wasn't designed for back-filing.
  return { ...BUNDLE_2025, isFallback: true };
}
