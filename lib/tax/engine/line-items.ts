import { getTaxYearConstants } from "../constants";
import type { FilingStatus } from "../constants-2025";

// Standalone per-line-item calculators: mileage, simplified home office, and
// the non-refundable family credits. Each is a self-contained `compute*`
// helper used both by forecast() and directly by callers (dashboard, goals,
// calculators), so they're kept together and re-exported from forecast.ts.

/**
 * Compute mileage deduction in cents, annualized from year-to-date miles.
 * If business profile only stores YTD miles, we project to year-end.
 */
export function computeMileageDeductionCents(args: {
  ytdMiles: number;
  monthsEntered: number;
  /**
   * Tax year so the helper picks the right IRS mileage rate. Optional
   * for backward-compat with callers from before the tax-year-aware
   * refactor; defaults to the current UTC year, which is what every
   * existing call site implicitly assumed.
   */
  taxYear?: number;
}): number {
  if (!args.ytdMiles || args.ytdMiles <= 0) return 0;
  const projectionFactor =
    args.monthsEntered > 0 ? 12 / Math.min(12, args.monthsEntered) : 1;
  const projectedMiles = args.ytdMiles * projectionFactor;
  const taxYear = args.taxYear ?? new Date().getUTCFullYear();
  const k = getTaxYearConstants(taxYear);
  return Math.round(projectedMiles * k.MILEAGE_RATE_PER_MILE_CENTS);
}

/**
 * Simplified home-office deduction: $5/sqft up to 300 sqft, max $1,500.
 * Returns 0 if either field is missing.
 */
export function computeHomeOfficeSimplifiedCents(args: {
  homeOfficeSqft: number | null;
  hasHomeOffice: boolean;
}): number {
  if (!args.hasHomeOffice) return 0;
  const sqft = args.homeOfficeSqft ?? 0;
  if (sqft <= 0) return 0;
  const eligibleSqft = Math.min(sqft, 300);
  return eligibleSqft * 500; // $5.00 per sqft = 500 cents
}

/**
 * Non-refundable family credits: Child Tax Credit ($2,000 / qualifying
 * child under 17) and Credit for Other Dependents ($500 each), reduced
 * by $50 per $1,000 (or fraction thereof) of AGI above the phase-out
 * threshold. The reduction applies to the COMBINED credit.
 */
export function computeFamilyCredits(args: {
  dependents: number;
  dependentsUnder17: number;
  filingStatus: FilingStatus;
  agiCents: number;
  /**
   * Tax year so the helper picks the right CTC maximum. The OBBBA
   * raised the CTC from $2,000 to $2,200 for 2025+ tax years; without
   * threading the year through, callers would silently keep computing
   * the pre-OBBBA $2,000 cap. Optional for callers that haven't
   * migrated; defaults to the current UTC year.
   */
  taxYear?: number;
}): number {
  const totalDependents = Math.max(0, args.dependents);
  const ctcChildren = Math.min(
    Math.max(0, args.dependentsUnder17),
    totalDependents,
  );
  const odcChildren = Math.max(0, totalDependents - ctcChildren);

  const taxYear = args.taxYear ?? new Date().getUTCFullYear();
  const k = getTaxYearConstants(taxYear);

  const baseCredit =
    ctcChildren * k.CHILD_TAX_CREDIT.ctcPerChildCents +
    odcChildren * k.CHILD_TAX_CREDIT.odcPerOtherCents;
  if (baseCredit <= 0) return 0;

  const phaseOutStart =
    k.CHILD_TAX_CREDIT.phaseOutStart[args.filingStatus] ?? 0;
  if (args.agiCents <= phaseOutStart) return baseCredit;

  // Reduction: $50 per $1,000 (or fraction) over threshold. Math in
  // cents: each $1,000 = 100,000 cents.
  const overCents = args.agiCents - phaseOutStart;
  const stepsOver = Math.ceil(overCents / 100_000);
  const reduction = stepsOver * k.CHILD_TAX_CREDIT.phaseOutReductionPer1000;
  return Math.max(0, baseCredit - reduction);
}
