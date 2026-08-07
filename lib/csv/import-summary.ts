// What is left to do on one import, counted from the rows themselves.
//
// bank_imports.applied_count read 0 on the 2026-08-01 import while 48
// rows were booked into monthly_expenses. It is written by
// applyTransactions and by bellaAutoApply but not by the upload-time
// auto-categorize path that booked most of those rows, so it has been
// drifting ever since. The import list rendered it verbatim: "62 rows,
// 0 applied".
//
// The fix is not to add a fourth writer. A counter that can disagree
// with its own source of truth is worth less than the query it
// replaces, and this table is small enough that the query is free. So
// completion is computed here, never stored, and this function is the
// single definition of "resolved" for the import list, the review page,
// the Complete button's enablement, and the guard inside completeImport.
// See docs/superpowers/specs/2026-08-06-import-completion-design.md.

/** The only four columns that decide whether a row still needs a human. */
export type ImportRowState = {
  appliedExpenseId: string | null;
  appliedIncomeId: string | null;
  ignored: boolean;
};

export type ImportSummary = {
  total: number;
  /** Booked into monthly_expenses. The honest applied_count. */
  applied: number;
  /** Booked into monthly_income. */
  income: number;
  /** Resolved by the user deciding it is not a deduction. */
  ignored: number;
  /** Still waiting on a human. */
  unresolved: number;
  /** Every row is resolved and there is at least one row. */
  isComplete: boolean;
};

/**
 * Count each row exactly once.
 *
 * Precedence is applied, then income, then ignored. It matters because
 * the buckets are not mutually exclusive in the database: applying a row
 * whose category turns out to be a transfer sets both applied_expense_id
 * (from an earlier pass) and ignored, and a naive sum of three filters
 * would report 63 states across 62 rows. Being in monthly_expenses is
 * the strongest fact a row can carry, since that is the filed-deduction
 * surface, so it wins.
 *
 * isComplete requires total > 0. An import with no rows has nothing for
 * a human to have agreed with, and offering Complete on it would be a
 * control that asserts something false.
 *
 * Never throws. Null or undefined input is an empty import, not an
 * error: this runs on every render of the import list.
 */
export function summarizeImport(
  rows: readonly ImportRowState[] | null | undefined,
): ImportSummary {
  let applied = 0;
  let income = 0;
  let ignored = 0;
  let unresolved = 0;

  for (const r of rows ?? []) {
    if (r?.appliedExpenseId) applied++;
    else if (r?.appliedIncomeId) income++;
    else if (r?.ignored) ignored++;
    else unresolved++;
  }

  const total = applied + income + ignored + unresolved;
  return {
    total,
    applied,
    income,
    ignored,
    unresolved,
    isComplete: total > 0 && unresolved === 0,
  };
}

/**
 * The same tally for a whole company's worth of rows at once, keyed by
 * import.
 *
 * The import list needs one summary per import and must not issue one
 * query per row group. Imports with zero transactions never appear in
 * the returned map, so callers fall back to summarizeImport([]) rather
 * than reading a stale stored counter.
 */
export function summarizeImports(
  rows: readonly (ImportRowState & { importId: string })[] | null | undefined,
): Map<string, ImportSummary> {
  const grouped = new Map<string, ImportRowState[]>();
  for (const r of rows ?? []) {
    if (!r?.importId) continue;
    const bucket = grouped.get(r.importId);
    if (bucket) bucket.push(r);
    else grouped.set(r.importId, [r]);
  }
  const out = new Map<string, ImportSummary>();
  for (const [importId, bucket] of grouped) {
    out.set(importId, summarizeImport(bucket));
  }
  return out;
}
