// Whether one selected row becomes a monthly_expenses record, and what
// that record says.
//
// The removed applyTransactions made this decision inline, in a loop, with two
// nearly-identical branches for credit and non-credit accounts and four
// `continue` statements that drop a row without telling anyone. That was
// survivable when the button applied whatever happened to be tagged. It
// is not survivable behind a select-all: a silent drop on a deduction
// surface is indistinguishable from a bug, and the user cannot tell
// forty applied rows from thirty-six.
//
// So the sequencing lives here, returns a reason for everything it
// declines, and is tested case by case.

import { interpretAmount, type SignConvention } from "./sign-convention";

export type BookingRow = {
  amountCents: number;
  /** ISO date, "YYYY-MM-DD", as stored. */
  postedAt: string | null;
};

export type BookingContext = {
  convention: SignConvention;
  /** The tax year currently being filed. */
  taxYear: number;
  /** 1-12. Rows dated later than this are not booked yet. */
  currentMonth: number;
  /**
   * The chosen category is a transfer, a Schedule A personal item, or a
   * federal tax credit. All three are labels, never Schedule C lines.
   */
  isNonBusinessCategory: boolean;
  /** A credit-account row that looks like a payment from another account. */
  isCardPayment: boolean;
  /** The statement line reads like a subscription. */
  isSubscription: boolean;
};

export type BookingSkipReason =
  | "no_date"
  | "other_tax_year"
  | "future_month"
  | "zero_amount"
  | "not_an_expense";

export type BookingDecision =
  | {
      kind: "book";
      /** 1-12, from posted_at, not from today. */
      month: number;
      /** Always positive, so no caller does sign arithmetic. */
      amountCents: number;
      recurrence: "monthly" | "one_off";
    }
  /** Keep the category as a label, mark the row resolved, book nothing. */
  | { kind: "label_only"; reason: "not_deductible" | "card_payment" }
  | { kind: "skip"; reason: BookingSkipReason };

/**
 * Order of checks is the whole function.
 *
 * The two label_only cases come first because they are decisions about
 * what a row IS, and they hold whatever its date or amount turns out to
 * be. A credit-card payment is an inter-account transfer in January and
 * in December alike; running the date guards first would report a
 * transfer dated last year as "wrong tax year", which is true and
 * useless.
 *
 * The direction check is last and is defence in depth. partitionBatch
 * has already refused every refund, so reaching it means something
 * upstream changed. It stays because monthly_expenses is a filed-tax
 * surface and the cost of the redundant check is one comparison, while
 * the cost of it being absent was a $24.45 refund booked as a deduction.
 */
export function planExpenseBooking(
  row: BookingRow,
  ctx: BookingContext,
): BookingDecision {
  if (ctx.isCardPayment) return { kind: "label_only", reason: "card_payment" };
  if (ctx.isNonBusinessCategory) {
    return { kind: "label_only", reason: "not_deductible" };
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

  if (interpretAmount(row.amountCents, ctx.convention).direction !== "expense") {
    return { kind: "skip", reason: "not_an_expense" };
  }

  return {
    kind: "book",
    month,
    amountCents,
    recurrence: ctx.isSubscription ? "monthly" : "one_off",
  };
}
