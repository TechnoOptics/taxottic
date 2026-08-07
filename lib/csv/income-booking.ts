// Whether one row becomes a monthly_income record, and what that
// record says. The mirror of planExpenseBooking, and it exists for the
// same reason: the rules had a second, inline copy.
//
// planExpenseBooking was extracted after a $24.45 refund was booked as
// a deduction by an inline copy of the expense rules. The income rules
// kept theirs, inline in runBellaCategorize, untested, and they drifted
// in a worse direction.
//
// THE INCIDENT, 2026-08-06, on a real return. The owner coded a $4,000
// transaction "IN *OJALA-BARBOUR" as legal_pro, an EXPENSE category.
// The import was still typed business_checking at the time, where a
// positive amount reads as money coming in, so the inline income branch
// booked it as $4,000 of INCOME while the row still carried his expense
// code. That is $4,000 of invented revenue plus a $4,000 deduction
// lost: an $8,000 swing against him on a Schedule C. His classification
// was never consulted.
//
// So this file, and only this file, decides. It is pure, it returns a
// reason for everything it declines, and it is tested case by case.

import { interpretAmount, type SignConvention } from "./sign-convention";

export type IncomeBookingRow = {
  amountCents: number;
  /** ISO date, "YYYY-MM-DD", as stored. */
  postedAt: string | null;
  /**
   * bank_transactions.applied_category_code: the category a HUMAN
   * typed on this row. Never a suggestion. suggested_category_code is
   * a different column and must not be passed here, or Bella's own
   * guess would start vetoing Bella.
   */
  appliedCategoryCode: string | null;
};

export type IncomeBookingContext = {
  convention: SignConvention;
  /** The tax year currently being filed. */
  taxYear: number;
  /** 1-12. Rows dated later than this are not booked yet. */
  currentMonth: number;
  /** The statement line reads like a subscription. */
  isSubscription: boolean;
};

export type IncomeBookingSkipReason =
  | "user_category_conflict"
  | "no_date"
  | "other_tax_year"
  | "future_month"
  | "zero_amount"
  | "not_income";

export type IncomeBookingDecision =
  | {
      kind: "book";
      /** 1-12, from postedAt, not from today. */
      month: number;
      /** Always positive, so no caller does sign arithmetic. */
      amountCents: number;
      recurrence: "monthly" | "one_off";
    }
  | { kind: "skip"; reason: IncomeBookingSkipReason };

/**
 * Order of checks is the whole function.
 *
 * user_category_conflict is FIRST, ahead of every date and amount
 * guard, because it is a decision about what the row IS and it holds
 * whatever the date or the sign turns out to be. A row a human coded
 * legal_pro is not income in July and income in August, and reporting
 * it as "wrong tax year" would be true and useless. Putting it after
 * the sign check would be worse than useless: the sign check is exactly
 * what disagreed with the human in the incident above.
 *
 * An amount's sign is an INFERENCE, drawn from a convention that is
 * itself detected and correctable. A category a human typed is a
 * DECISION. When the two disagree the human wins, and the row is left
 * for review rather than booked either way. Leaving it unbooked is the
 * point: booking it as an expense on the strength of the code would be
 * the same mistake wearing the other hat, since nothing here knows
 * whether the code or the sign is the thing that is wrong.
 *
 * The remaining guards are the ones the inline copy already had, in the
 * order it had them. The last is the mirror of planExpenseBooking's:
 * never book as income anything the convention reads as a charge.
 */
export function planIncomeBooking(
  row: IncomeBookingRow,
  ctx: IncomeBookingContext,
): IncomeBookingDecision {
  if (row.appliedCategoryCode) {
    return { kind: "skip", reason: "user_category_conflict" };
  }

  if (!row.postedAt) return { kind: "skip", reason: "no_date" };
  const posted = new Date(row.postedAt + "T00:00:00Z");
  const year = posted.getUTCFullYear();
  const month = posted.getUTCMonth() + 1;
  if (!Number.isFinite(year)) return { kind: "skip", reason: "no_date" };
  if (year !== ctx.taxYear) return { kind: "skip", reason: "other_tax_year" };
  if (month > ctx.currentMonth) return { kind: "skip", reason: "future_month" };

  const amountCents = Math.abs(row.amountCents);
  if (!amountCents) return { kind: "skip", reason: "zero_amount" };

  if (interpretAmount(row.amountCents, ctx.convention).direction === "expense") {
    return { kind: "skip", reason: "not_income" };
  }

  return {
    kind: "book",
    month,
    amountCents,
    recurrence: ctx.isSubscription ? "monthly" : "one_off",
  };
}
