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

// ---------------------------------------------------------------------
// Claiming the transaction
// ---------------------------------------------------------------------
// planExpenseBooking answers "should this row become an expense". It
// cannot answer "did it already", because that is a fact about the
// database at the instant of the write, and the whole 2026-08-06
// incident was 32 rows that answered it correctly and were wrong 21
// seconds later.
//
// So the claim is made by book_bank_transaction_expense (see
// 20260808020000_expense_source_transaction.sql), and what is left for
// this file is the part worth testing without a database: reading that
// function's answer, and in particular refusing to call a duplicate a
// failure. A duplicate means the row is booked exactly once, which is
// what the caller asked for. Counting it as failed would put "1 failed"
// in a banner about a batch that did what the user wanted, and counting
// it as done would report the same expense twice.

/**
 * What the caller should do with the row.
 *
 * - `booked`         a new expense exists and the transaction points at it
 * - `already_booked` some expense already claims it, nothing was written
 * - `failed`         nothing was written and the reason is not benign
 */
export type BookingClaimStatus = "booked" | "already_booked" | "failed";

export type BookingClaimOutcome = {
  status: BookingClaimStatus;
  /** Present for `booked`, and for `already_booked` when the winner is known. */
  expenseId: string | null;
  /**
   * The claim function is not in the database yet.
   *
   * Migrations here are applied by a human, deliberately and after the
   * code merges (see docs/migration-history-state.md). Between the merge
   * and the apply, the import must keep working, so the caller falls
   * back to its older path. This flag is the only honest way to tell
   * "the function said no" from "there is no function".
   */
  functionMissing: boolean;
};

/** PostgREST cannot find the function in its schema cache. */
const PGRST_FUNCTION_MISSING = "PGRST202";
/** Postgres undefined_function, if the call reaches the server at all. */
const PG_UNDEFINED_FUNCTION = "42883";

function looksLikeMissingFunction(code: string, message: string): boolean {
  if (code === PGRST_FUNCTION_MISSING || code === PG_UNDEFINED_FUNCTION) {
    return true;
  }
  const m = message.toLowerCase();
  return (
    m.includes("could not find the function") ||
    m.includes("does not exist") &&
      m.includes("book_bank_transaction_expense")
  );
}

/**
 * Read one book_bank_transaction_expense response.
 *
 * Pure, so the mapping from every answer the database can give to every
 * number the banner shows is testable without a database. The statuses
 * are the function's, verbatim, and an unrecognised one is `failed`
 * rather than an assumption: silently treating an unknown answer as
 * success on a deduction surface is how the counts stopped matching
 * reality in the first place.
 */
export function interpretBookingClaim(result: {
  data: unknown;
  error: { code?: string | null; message?: string | null } | null;
}): BookingClaimOutcome {
  if (result.error) {
    const code = result.error.code ?? "";
    const message = result.error.message ?? "";
    return {
      status: "failed",
      expenseId: null,
      functionMissing: looksLikeMissingFunction(code, message),
    };
  }

  const payload = result.data as
    | { status?: unknown; expense_id?: unknown }
    | null
    | undefined;
  const status = typeof payload?.status === "string" ? payload.status : "";
  const expenseId =
    typeof payload?.expense_id === "string" ? payload.expense_id : null;

  if (status === "booked") {
    // A "booked" with no id is not a booking anyone can point at.
    if (!expenseId) return { status: "failed", expenseId: null, functionMissing: false };
    return { status: "booked", expenseId, functionMissing: false };
  }
  if (status === "already_booked") {
    return { status: "already_booked", expenseId, functionMissing: false };
  }
  // booked_as_income, or anything this version of the code has not seen.
  return { status: "failed", expenseId: null, functionMissing: false };
}
