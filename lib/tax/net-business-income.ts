/**
 * Single source of truth for "net business income" math across the
 * product. Forecast and export both call this so their headline numbers
 * agree, and Schedule C Line 24b is rendered with the post-50%
 * deductible meals figure — not the gross.
 *
 * Why this file exists. The May 2026 audit (`docs/audits/2026-05-13-
 * company-creation-income-expenses.md`) found a $100 disagreement on
 * "Net Business Income" between `/c/{id}/forecast` ($21,498) and
 * `/c/{id}/export` ($21,398) for the same dataset. Root cause: the
 * forecast engine applies IRC §274(n)'s 50% meals limitation; the
 * export was summing raw `amount_cents` for every expense category and
 * carrying the gross meals figure forward to Schedule C Line 24b. That
 * is the exact line label a CPA reads as "deductible after the 50%
 * limit." Misreporting it under-pays the IRS.
 *
 * This helper is the only place the meals rule lives. Both surfaces
 * call `computeNetBusinessIncome` and `deductibleAmountForCategory`,
 * which guarantees consistency.
 */
import { ABOVE_THE_LINE_CODES } from "./forecast";

/** Category code for IRC §274(n) meals (50% deductible business meals). */
export const MEALS_CATEGORY_CODE = "meals";

/**
 * IRC §274(n) limits the deduction for business meals to 50% of the
 * expense. The audit user logged $200 in meals expecting Schedule C
 * Line 24b to show $100; the export was showing $200. This is the
 * exact constant used to compute the half, exported for tests.
 */
export const MEALS_DEDUCTIBLE_FRACTION = 0.5;

/**
 * Given a category code and the *gross* logged amount (what the user
 * actually spent, in cents), return the amount that flows to Schedule C
 * as a deduction.
 *
 * - `meals`            → gross × 0.5 (IRC §274(n)).
 * - above-the-line     → 0 (these are Schedule 1 adjustments, not
 *                          Schedule C expenses; they reduce AGI later
 *                          via the forecast engine).
 * - everything else    → gross.
 *
 * Above-the-line codes are filtered to 0 (rather than dropped) so a
 * caller iterating a category list still gets a stable shape; they
 * can choose whether to render the row.
 */
export function deductibleAmountForCategory(
  categoryCode: string,
  grossCents: number,
): number {
  if (categoryCode === MEALS_CATEGORY_CODE) {
    return Math.round(grossCents * MEALS_DEDUCTIBLE_FRACTION);
  }
  if (ABOVE_THE_LINE_CODES.has(categoryCode)) {
    return 0;
  }
  return grossCents;
}

/** Per-category breakdown used by the export's expenses-by-category table. */
export type CategoryTotals = {
  /** Stable category code (matches `monthly_expenses.category_code`). */
  code: string;
  /** Raw user-logged cents — useful for "Logged: $X" detail rows. */
  grossCents: number;
  /**
   * Cents that flow to Schedule C / the net-business-income subtraction.
   * For most categories this equals `grossCents`; for `meals` it is
   * `gross × 0.5`; for above-the-line codes it is 0.
   */
  deductibleCents: number;
  /** Count of underlying rows (for "n entries" pluralisation). */
  count: number;
};

/**
 * Roll up monthly_expenses rows into per-category totals with both the
 * gross and post-IRC-rules deductible amounts.
 *
 * IMPORTANT: meals get the 50% haircut applied to `deductibleCents`.
 * Renderers that fill Schedule C Line 24b MUST use `deductibleCents`,
 * not `grossCents`. The audit's Critical #2 was the export displaying
 * gross under the Line 24b label.
 */
export function expensesByCategory(
  rows: ReadonlyArray<{ category_code: string; amount_cents: number }>,
): CategoryTotals[] {
  const byCode = new Map<string, CategoryTotals>();
  for (const r of rows) {
    const code = r.category_code;
    const existing = byCode.get(code) ?? {
      code,
      grossCents: 0,
      deductibleCents: 0,
      count: 0,
    };
    existing.grossCents += r.amount_cents;
    existing.count += 1;
    byCode.set(code, existing);
  }
  // Compute deductibleCents from the rollup so the 50% rounding lands
  // on the category total (not per-row), matching the forecast engine's
  // `Math.round(input.ytdMealsCents * 0.5)` semantics.
  for (const totals of byCode.values()) {
    totals.deductibleCents = deductibleAmountForCategory(
      totals.code,
      totals.grossCents,
    );
  }
  return [...byCode.values()];
}

export type NetBusinessIncomeInput = {
  /** Sum of `monthly_income.amount_cents` for the period in question. */
  incomeCents: number;
  /** Per-category expense rollup (use `expensesByCategory()` to build). */
  byCategory: ReadonlyArray<CategoryTotals>;
};

export type NetBusinessIncomeResult = {
  /** Sum of all income, identical to input.incomeCents. */
  grossIncomeCents: number;
  /** Sum of `grossCents` across non-above-the-line categories. */
  grossExpensesCents: number;
  /** Sum of `deductibleCents` across non-above-the-line categories. */
  deductibleExpensesCents: number;
  /**
   * `max(0, grossIncome - deductibleExpenses)`. This is the number that
   * goes on Schedule C Line 31 ("Net profit or loss") and the headline
   * "Net business income" on both the forecast and the export.
   */
  netBusinessIncomeCents: number;
};

/**
 * Compute the canonical net business income. Both `/c/{id}/forecast`
 * and `/c/{id}/export` call this on the same dataset so their headline
 * numbers cannot disagree.
 *
 * Definitions intentionally match the forecast engine
 * (`lib/tax/forecast.ts:421-428`):
 *   ytdDeductibleExpenses = businessExpenses + meals × 0.5 + ... (auto
 *                            mileage, home office, § 179 are added by
 *                            the engine; the export doesn't have those
 *                            so they're zero here)
 *   ytdNetBiz             = max(0, income - deductibleExpenses)
 */
export function computeNetBusinessIncome(
  input: NetBusinessIncomeInput,
): NetBusinessIncomeResult {
  let grossExpensesCents = 0;
  let deductibleExpensesCents = 0;
  for (const t of input.byCategory) {
    // Above-the-line codes don't belong on Schedule C in either column.
    // They've already been excluded by `deductibleAmountForCategory`
    // returning 0 for them, but we also skip the gross to keep the
    // export's "Total expenses" line honest — those dollars aren't a
    // business expense, they're a Schedule 1 adjustment.
    if (ABOVE_THE_LINE_CODES.has(t.code)) continue;
    grossExpensesCents += t.grossCents;
    deductibleExpensesCents += t.deductibleCents;
  }
  const netBusinessIncomeCents = Math.max(
    0,
    input.incomeCents - deductibleExpensesCents,
  );
  return {
    grossIncomeCents: input.incomeCents,
    grossExpensesCents,
    deductibleExpensesCents,
    netBusinessIncomeCents,
  };
}
