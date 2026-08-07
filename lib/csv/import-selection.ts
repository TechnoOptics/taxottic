// Which rows a batch action is allowed to touch.
//
// The import review screen had no checkboxes and exactly one commit
// control, reading "Apply manually selected" while nothing on the page
// could be selected. It applied whatever carried applied_category_code,
// which is not a selection, it is a residue of having pressed Save on
// rows one at a time. On the live import that was one row, under
// thirteen rows displaying Bella's suggested_category_code, a different
// column, which looked chosen and was not.
//
// Adding checkboxes multiplies whatever the model gets wrong by the size
// of the batch, so the selection rules live here, in pure functions, and
// the server actions are thin over them. The precedent is direct: on
// 2026-08-06 five defects in the sign-convention work all lived in caller
// code wrapping correct, well-tested pure functions, including one that
// made refund netting silently dead while 742 tests passed.
//
// See docs/superpowers/specs/2026-08-06-import-batch-selection-design.md.

import { interpretAmount, type SignConvention } from "./sign-convention";
import type { BookingSkipReason } from "./expense-booking";

/** Everything a selection decision reads. Callers may pass richer rows. */
export type SelectionRow = {
  id: string;
  importId: string;
  companyId: string;
  amountCents: number;
  suggestedCategoryCode: string | null;
  appliedCategoryCode: string | null;
  appliedExpenseId: string | null;
  appliedIncomeId: string | null;
  ignored: boolean;
};

/** A selection row plus the fields booking one actually needs. */
export type BatchRow = SelectionRow & {
  description: string;
  postedAt: string | null;
};

export type BatchIntent = "apply" | "accept" | "ignore";

export type SkipReason =
  /** No such row in this import. A deleted row, or a guess. */
  | "unknown"
  /** The row exists but belongs to another import or another company. */
  | "foreign"
  /** The same id was posted more than once in one batch. */
  | "duplicate"
  /** The convention reads this row as money coming back. Never bookable. */
  | "refund"
  /** Not a charge under this file's convention, so not an expense candidate. */
  | "income"
  /** Already in monthly_expenses or monthly_income. */
  | "already_booked"
  /** Already resolved by ignoring it. */
  | "ignored"
  /** Apply had nothing to book it under. */
  | "no_category"
  /** Accept had no Bella suggestion to accept. */
  | "no_suggestion";

/** Everything a batch can decline to do, from either stage. */
export type BatchSkipReason = SkipReason | BookingSkipReason;

export type BatchPlanItem<T extends SelectionRow> = {
  row: T;
  /** The code the action must write. Null only for the ignore intent. */
  categoryCode: string | null;
};

export type BatchPlan<T extends SelectionRow> = {
  actionable: BatchPlanItem<T>[];
  skipped: { id: string; reason: SkipReason }[];
};

export type SelectionSummary = {
  /** How many rows a select-all may honestly offer. */
  selectable: number;
  /** How many of the posted ids are actually selectable. */
  selected: number;
  /** Rows the convention reads as a refund, booked or not. */
  refunds: number;
  /** Rows already in monthly_expenses or monthly_income. */
  alreadyBooked: number;
  selectableIds: string[];
  /** The honest intersection: selected ids that are really selectable. */
  selectedIds: string[];
  /** Every selectable row is selected, and there is at least one. */
  allSelected: boolean;
  /** Some but not all: the header checkbox's third state. */
  indeterminate: boolean;
};

/**
 * The one reason a row cannot be batched, or null if it can.
 *
 * isSelectable and partitionBatch both route through this, so the
 * checkbox the user sees and the check the server re-runs can never
 * disagree about a row. Two hand-written filters that were "obviously
 * the same rule" is how a refund ended up booked as a deduction.
 *
 * Ordering is deliberate. Already-booked is reported ahead of refund
 * because it is the more actionable answer for a stale tab, which is the
 * ordinary case: the user opens the page, walks away, Bella's cron books
 * four rows, they come back and press Apply on a selection that includes
 * them.
 */
function rejectReason(
  row: SelectionRow,
  convention: SignConvention,
): SkipReason | null {
  if (row.appliedExpenseId || row.appliedIncomeId) return "already_booked";
  if (row.ignored) return "ignored";
  const { direction } = interpretAmount(row.amountCents, convention);
  if (direction === "refund") return "refund";
  // Zero-amount rows land here too: interpretAmount calls zero income,
  // and a zero-value deduction is noise, never a candidate.
  if (direction !== "expense") return "income";
  return null;
}

/**
 * Can this row carry a checkbox at all?
 *
 * Refunds, income and rows already booked have no checkbox, not a
 * disabled one. A disabled control invites "why can't I tick this" and
 * the honest answer belongs in the row, not in a tooltip on a dead
 * affordance. More importantly, absence is structural: a select-all
 * cannot reach a row that was never in the selection model, whereas a
 * disabled checkbox is one markup regression away from being reachable.
 *
 * monthly_expenses is a filed-tax-deduction surface. A refund booked
 * there inflates a deduction, which is what happened to a $24.45 return
 * on the 2026-08-01 import.
 */
export function isSelectable(
  row: SelectionRow | null | undefined,
  convention: SignConvention,
): boolean {
  if (!row) return false;
  return rejectReason(row, convention) === null;
}

/**
 * What the header of the candidate list should say.
 *
 * refunds and alreadyBooked are independent counts over the same rows,
 * not a partition: the live import's Lowe's refund is both. Only
 * `selectable` is disjoint from them, and it is the only one a
 * select-all acts on.
 *
 * `selected` counts the intersection with what is really selectable, so
 * a stale posted id inflates nothing. The client's selection is a
 * request, not an authorization.
 */
export function summarizeSelection<T extends SelectionRow>(
  rows: readonly T[] | null | undefined,
  selectedIds: readonly string[] | null | undefined,
  convention: SignConvention,
): SelectionSummary {
  const wanted = new Set(selectedIds ?? []);
  const selectableIds: string[] = [];
  const chosen: string[] = [];
  let refunds = 0;
  let alreadyBooked = 0;

  for (const row of rows ?? []) {
    if (!row) continue;
    if (row.appliedExpenseId || row.appliedIncomeId) alreadyBooked++;
    if (interpretAmount(row.amountCents, convention).direction === "refund") {
      refunds++;
    }
    if (!isSelectable(row, convention)) continue;
    selectableIds.push(row.id);
    if (wanted.has(row.id)) chosen.push(row.id);
  }

  return {
    selectable: selectableIds.length,
    selected: chosen.length,
    refunds,
    alreadyBooked,
    selectableIds,
    selectedIds: chosen,
    allSelected: selectableIds.length > 0 && chosen.length === selectableIds.length,
    indeterminate: chosen.length > 0 && chosen.length < selectableIds.length,
  };
}

/**
 * Split a posted batch into what will be acted on and what will not.
 *
 * This is the function a defect in books the wrong rows in bulk, so it
 * decides everything and the actions decide nothing: membership, scope,
 * duplicates, selectability, and which category code the write must use.
 *
 * `scope` is required rather than optional, a deliberate departure from
 * the spec's three-argument signature. An optional safety check is a
 * safety check a caller can forget, and forgetting this one means
 * accepting ids from another company.
 *
 * Nothing here throws and nothing fails the batch. A posted id that is a
 * refund, already booked, or foreign is dropped and reported, because
 * booking 40 rows where row 17 is stale should keep the 39. An
 * all-or-nothing batch sounds safer and is not: it turns one bad row
 * into zero progress, on a screen whose entire complaint is that
 * progress is too slow.
 */
export function partitionBatch<T extends SelectionRow>(
  rows: readonly T[] | null | undefined,
  postedIds: readonly string[] | null | undefined,
  convention: SignConvention,
  scope: { importId: string; companyId: string },
  intent: BatchIntent,
): BatchPlan<T> {
  const byId = new Map<string, T>();
  for (const r of rows ?? []) {
    if (r?.id) byId.set(r.id, r);
  }

  const actionable: BatchPlanItem<T>[] = [];
  const skipped: { id: string; reason: SkipReason }[] = [];
  const seen = new Set<string>();

  for (const rawId of postedIds ?? []) {
    const id = typeof rawId === "string" ? rawId : String(rawId ?? "");
    if (!id) continue;
    if (seen.has(id)) {
      skipped.push({ id, reason: "duplicate" });
      continue;
    }
    seen.add(id);

    const row = byId.get(id);
    if (!row) {
      skipped.push({ id, reason: "unknown" });
      continue;
    }
    if (row.importId !== scope.importId || row.companyId !== scope.companyId) {
      skipped.push({ id, reason: "foreign" });
      continue;
    }
    const reason = rejectReason(row, convention);
    if (reason) {
      skipped.push({ id, reason });
      continue;
    }

    if (intent === "ignore") {
      actionable.push({ row, categoryCode: null });
      continue;
    }
    // Apply books what a human chose. Accept books what Bella proposed.
    // Keeping them apart preserves something worth preserving on a tax
    // record: whether a person ever agreed with the software. Apply
    // falling back to the suggestion would erase that distinction
    // silently, one bulk press at a time.
    const code =
      intent === "apply" ? row.appliedCategoryCode : row.suggestedCategoryCode;
    if (!code) {
      skipped.push({
        id,
        reason: intent === "apply" ? "no_category" : "no_suggestion",
      });
      continue;
    }
    actionable.push({ row, categoryCode: code });
  }

  return { actionable, skipped };
}

const SKIP_LABELS: Record<BatchSkipReason, [string, string]> = {
  unknown: ["row no longer in this import", "rows no longer in this import"],
  foreign: ["row from another import", "rows from another import"],
  duplicate: ["duplicate", "duplicates"],
  refund: ["refund", "refunds"],
  income: ["non-expense row", "non-expense rows"],
  already_booked: ["already booked", "already booked"],
  ignored: ["already ignored", "already ignored"],
  no_category: ["row with no category", "rows with no category"],
  no_suggestion: ["row with no suggestion", "rows with no suggestion"],
  no_date: ["row with no date", "rows with no date"],
  other_tax_year: ["row from another tax year", "rows from another tax year"],
  future_month: ["row dated ahead of this month", "rows dated ahead of this month"],
  zero_amount: ["zero-value row", "zero-value rows"],
  not_an_expense: ["row that is not a charge", "rows that are not charges"],
};

/**
 * One line stating what a batch did, for the banner after the redirect.
 *
 * Plain counts, no celebration. "Applied 39. Skipped 1 refund. 0 failed."
 * is the whole message, and every skip reason is named because a silent
 * skip on a deduction surface is indistinguishable from a bug. Anything
 * a batch declined to do has to be legible from the banner alone, since
 * the rows themselves have already slid off the list.
 */
export function describeBatchOutcome(args: {
  verb: string;
  done: number;
  skipped: readonly { reason: BatchSkipReason }[];
  failed: number;
  /** Rows kept as a label rather than booked: transfers, Schedule A, card payments. */
  labelled?: number;
}): string {
  const parts = [`${args.verb} ${args.done}.`];
  if (args.labelled && args.labelled > 0) {
    parts.push(
      `Labelled ${args.labelled} as not deductible without booking ${args.labelled === 1 ? "it" : "them"}.`,
    );
  }
  const counts = new Map<BatchSkipReason, number>();
  for (const s of args.skipped ?? []) {
    counts.set(s.reason, (counts.get(s.reason) ?? 0) + 1);
  }
  const phrases: string[] = [];
  for (const [reason, n] of counts) {
    const [one, many] = SKIP_LABELS[reason];
    phrases.push(`${n} ${n === 1 ? one : many}`);
  }
  if (phrases.length > 0) parts.push(`Skipped ${phrases.join(", ")}.`);
  parts.push(`${args.failed} failed.`);
  return parts.join(" ");
}
