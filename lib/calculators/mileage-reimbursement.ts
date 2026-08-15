import { getTaxYearConstants } from "@/lib/tax/constants";

/**
 * Team mileage reimbursement, priced at the IRS standard rate.
 *
 * The question this answers is the one a small employer actually asks:
 * "if my people drive for work, what does reimbursing them cost me, and
 * what does it cost me after tax?"
 *
 * Three facts make the answer non-obvious, and all three are why this
 * cannot be a back-of-envelope multiplication:
 *
 * 1. Reimbursement at or below the IRS standard rate under an
 *    accountable plan is a deductible business expense AND is not
 *    taxable wages to the employee. No payroll tax, no W-2 line. Pay
 *    above the standard rate and the excess becomes taxable wages.
 * 2. The rate is not one number. 2026 runs 72.5 cents to Jun 30 and 76
 *    cents from Jul 1, so a flat annual multiply is wrong by the size of
 *    the mid-year change.
 * 3. The real cost is net of the deduction, which is what an owner is
 *    actually deciding about.
 *
 * Rates come from the tax year, never from a literal. See
 * lib/tax/rate-copy.test.ts for why that rule exists.
 */

export type ReimbursementPeriod = {
  /** e.g. "Jan to Jun" */
  label: string;
  months: number;
  centsPerMile: number;
  miles: number;
  cents: number;
};

export type ReimbursementResult = {
  annualMilesPerDriver: number;
  annualMilesTotal: number;
  periods: ReimbursementPeriod[];
  /** Total reimbursement owed to the team for the year, in cents. */
  totalCents: number;
  perDriverCents: number;
  /** Tax saved because the reimbursement is deductible, in cents. */
  taxSavedCents: number;
  /** Reimbursement minus the tax it saves. */
  netCostCents: number;
  /** True when the year has more than one rate in force. */
  isSplitYear: boolean;
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Rate periods for a year, each with how many calendar months it covers.
 * A single-rate year yields one entry covering all twelve.
 */
export function ratePeriodsForYear(taxYear: number): {
  label: string;
  months: number;
  centsPerMile: number;
}[] {
  const c = getTaxYearConstants(taxYear);
  const raw = c.MILEAGE_RATE_PERIODS ?? [
    { fromIso: `${taxYear}-01-01`, centsPerMile: c.MILEAGE_RATE_PER_MILE_CENTS },
  ];
  return raw.map((p, i, all) => {
    // Month index is taken from the ISO string rather than a Date, so a
    // machine in a negative UTC offset cannot shift the boundary a day
    // and land the split in the wrong month.
    const startMonth = Number(p.fromIso.slice(5, 7)) - 1;
    const endExclusive = all[i + 1]
      ? Number(all[i + 1].fromIso.slice(5, 7)) - 1
      : 12;
    const months = endExclusive - startMonth;
    const label =
      months === 12
        ? "All year"
        : `${MONTH_NAMES[startMonth]} to ${MONTH_NAMES[endExclusive - 1]}`;
    return { label, months, centsPerMile: p.centsPerMile };
  });
}

export function calculateReimbursement({
  drivers,
  milesPerDriverPerMonth,
  taxYear,
  marginalRate,
}: {
  drivers: number;
  milesPerDriverPerMonth: number;
  taxYear: number;
  /** Combined marginal rate used only for the tax-saved estimate. */
  marginalRate: number;
}): ReimbursementResult {
  const d = Math.max(0, drivers);
  const perMonth = Math.max(0, milesPerDriverPerMonth);
  const periods = ratePeriodsForYear(taxYear);

  const rows: ReimbursementPeriod[] = periods.map((p) => {
    const miles = perMonth * p.months * d;
    return {
      label: p.label,
      months: p.months,
      centsPerMile: p.centsPerMile,
      miles,
      // Rounded per period, not at the end: this mirrors how the
      // reimbursement is actually paid out, and keeps the displayed
      // rows summing to the displayed total.
      cents: Math.round(miles * p.centsPerMile),
    };
  });

  const totalCents = rows.reduce((s, r) => s + r.cents, 0);
  const annualMilesPerDriver = perMonth * 12;

  return {
    annualMilesPerDriver,
    annualMilesTotal: annualMilesPerDriver * d,
    periods: rows,
    totalCents,
    perDriverCents: d > 0 ? Math.round(totalCents / d) : 0,
    taxSavedCents: Math.round(totalCents * marginalRate),
    netCostCents: totalCents - Math.round(totalCents * marginalRate),
    isSplitYear: periods.length > 1,
  };
}

/**
 * Price miles entered per rate period, at each period's own rate.
 *
 * Extracted so it can be TESTED, which was the whole problem.
 * lib/tax/split-rate-mileage.test.ts originally defined its own copy of
 * this loop and asserted against that, so reverting the calculator to a
 * single flat rate, the exact bug the file exists to prevent, left all
 * of its tests green. A guard that re-implements the code it guards
 * protects nothing.
 *
 * Rounds ONCE on the total. Callers that display per-period lines round
 * those separately for display only; the deduction figure is this one.
 */
export function priceMilesByPeriod(
  milesPerPeriod: number[],
  periods: { centsPerMile: number }[],
): number {
  return Math.round(
    periods.reduce(
      (sum, p, i) => sum + Math.max(0, milesPerPeriod[i] ?? 0) * p.centsPerMile,
      0,
    ),
  );
}
