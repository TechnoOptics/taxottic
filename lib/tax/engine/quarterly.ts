import { QUARTERLY_DUE_DATES_2025 } from "../constants-2025";
import type { QuarterlyEstimate } from "../forecast";

/**
 * Split annual liability into Q1-Q4 estimated payments. Each quarter
 * is responsible for a quarter of the annual total minus the slice
 * of W-2 withholding the IRS treats as paid evenly through the year.
 * Estimated payments the user has already made are subtracted from
 * the earliest still-due quarter so the schedule reflects "how much
 * more you should send."
 */
export function buildQuarterlyEstimates(args: {
  taxYear: number;
  totalTaxCents: number;
  w2WithheldCents: number;
  estimatedPaymentsCents: number;
}): QuarterlyEstimate[] {
  const today = new Date();
  // Quarter target: total annual tax / 4 minus the quarter's share of
  // W-2 withholding (treated as paid throughout the year).
  const perQuarterGross = Math.round(args.totalTaxCents / 4);
  const perQuarterWithholdingCredit = Math.round(args.w2WithheldCents / 4);
  const baseQuarterCents = Math.max(
    0,
    perQuarterGross - perQuarterWithholdingCredit,
  );

  // Spread previously-made estimated payments against the earliest
  // quarters so the user sees future quarters as the catch-up.
  let estimatesRemaining = Math.max(0, args.estimatedPaymentsCents);
  return QUARTERLY_DUE_DATES_2025.map((d) => {
    const dueYear = d.inFollowingYear ? args.taxYear + 1 : args.taxYear;
    const dueDate = new Date(Date.UTC(dueYear, d.month - 1, d.day));
    const isPast = dueDate.getTime() < today.getTime();
    let amount = baseQuarterCents;
    const credit = Math.min(estimatesRemaining, amount);
    amount -= credit;
    estimatesRemaining -= credit;
    return {
      quarter: d.quarter,
      dueDate: dueDate.toISOString().slice(0, 10),
      amountCents: Math.max(0, amount),
      isPast,
    };
  });
}

/**
 * Number of months from today until the federal filing deadline (Apr 15
 * of the following calendar year). Used to spread "still owed" into a
 * monthly save-target.
 */
export function remainingMonthsToFilingDeadline(taxYear: number): number {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;
  if (taxYear > currentYear) return 12;
  // Months left in the calendar tax year + Jan/Feb/Mar/Apr of next year (4)
  return Math.max(1, 12 - currentMonth + 4);
}
