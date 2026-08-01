/**
 * Checkbox rules for the import review screen.
 *
 * Kept as pure functions with no React in them for two reasons: the same
 * rules have to run again on the server when the form posts (a client can
 * send any id it likes), and the checkbox defaults are a tax-correctness
 * decision that deserves tests rather than a hand check in the browser.
 *
 * The safety asymmetry that drives the defaults:
 *
 *   A row left unchecked that should have been claimed is a MISSED
 *   deduction. It is still on the screen, still listed, and the user can
 *   check it. Cost: some money left on the table, recoverable in seconds.
 *
 *   A row checked that should not have been claimed is a WRONG NUMBER on a
 *   Schedule C. Nobody notices until an auditor does. Cost: penalties, and
 *   the user's trust in every other number we produce.
 *
 * So a category a HUMAN chose rides in pre-selected; a category a MACHINE
 * guessed does not. "Select all" is the one-click bulk path and it does
 * reach the guesses, because at that point the user has asked for them.
 */

export type SelectableRow = {
  id: string;
  posted_at: string | null;
  description: string;
  amount_cents: number;
  applied_category_code: string | null;
  suggested_category_code: string | null;
  applied_expense_id: string | null;
  applied_income_id: string | null;
  ignored: boolean;
};

export type SelectionContext = {
  /** Credit-card imports invert the sign convention. */
  isCredit: boolean;
  /** The tax year expenses may be booked into. */
  taxYear: number;
  /** 1-12. Future months cannot be booked. */
  currentMonth: number;
};

/**
 * Why a row can or cannot become a business expense. Every non-eligible
 * state is rendered on the row with this reason, because each one of them is
 * a case `applyTransactions` silently skipped before.
 */
export type Eligibility =
  | "eligible"
  | "booked"
  | "ignored"
  | "needs_category"
  | "needs_date"
  | "out_of_range"
  | "not_an_expense";

/** The category that would actually be used: the human pick, else the guess. */
export function effectiveCategory(row: SelectableRow): string | null {
  return row.applied_category_code ?? row.suggested_category_code ?? null;
}

/** True when the category came from a person, not from the model. */
export function isHumanCategorized(row: SelectableRow): boolean {
  return !!row.applied_category_code;
}

export function rowEligibility(
  row: SelectableRow,
  ctx: SelectionContext,
): Eligibility {
  if (row.applied_expense_id || row.applied_income_id) return "booked";
  if (row.ignored) return "ignored";

  // Sign convention. On checking/savings, money out is negative. On a credit
  // card, a charge is positive and a negative is a refund or a payment from
  // another account, neither of which is a deduction.
  const isExpenseSide = ctx.isCredit
    ? row.amount_cents > 0
    : row.amount_cents < 0;
  if (!isExpenseSide) return "not_an_expense";

  if (!row.posted_at) return "needs_date";

  const year = Number(row.posted_at.slice(0, 4));
  const month = Number(row.posted_at.slice(5, 7));
  if (!Number.isFinite(year) || !Number.isFinite(month)) return "needs_date";
  if (year !== ctx.taxYear || month > ctx.currentMonth) return "out_of_range";

  if (!effectiveCategory(row)) return "needs_category";

  return "eligible";
}

/** Every row "Select all" is allowed to reach. */
export function selectableIds(
  rows: SelectableRow[],
  ctx: SelectionContext,
): string[] {
  return rows
    .filter((r) => rowEligibility(r, ctx) === "eligible")
    .map((r) => r.id);
}

/**
 * The boxes that are ticked when the screen first loads: eligible rows whose
 * category a human chose. See the note at the top of this file for why a
 * model's suggestion does not qualify.
 */
export function defaultSelectedIds(
  rows: SelectableRow[],
  ctx: SelectionContext,
): string[] {
  return rows
    .filter(
      (r) => rowEligibility(r, ctx) === "eligible" && isHumanCategorized(r),
    )
    .map((r) => r.id);
}

/**
 * What the confirm button says: how many rows and how much money. Re-checks
 * eligibility so a stale selection can never inflate the total the user is
 * shown, and the server runs the same function over the posted ids before it
 * writes anything.
 */
export function summarize(
  rows: SelectableRow[],
  selected: ReadonlySet<string>,
  ctx: SelectionContext,
): { count: number; totalCents: number } {
  let count = 0;
  let totalCents = 0;
  for (const row of rows) {
    if (!selected.has(row.id)) continue;
    if (rowEligibility(row, ctx) !== "eligible") continue;
    count++;
    // Integer cents only. monthly_expenses.amount_cents is a non-negative
    // bigint, so the magnitude is what gets booked.
    totalCents += Math.abs(row.amount_cents);
  }
  return { count, totalCents };
}
