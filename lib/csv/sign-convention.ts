// How to read the signs in one import's rows.
//
// A real import on 2026-08-01 used charges-positive, refunds-negative.
// The review page filtered candidates with `amount_cents < 0`, so it
// offered two refunds for categorization and hid sixty real expenses,
// with no way to correct it after upload. See
// docs/superpowers/specs/2026-08-06-csv-sign-convention-design.md.

export type SignConvention = "charges_negative" | "charges_positive";
export type AmountDirection = "expense" | "refund" | "income";

/** Below this confidence the review page shows a banner, not a quiet line. */
export const SIGN_CONFIDENCE_BANNER = 0.75;

/** Fewer signed rows than this and the split proves nothing. */
const MIN_ROWS_FOR_DETECTION = 8;

/**
 * The majority sign is charges.
 *
 * People make far more purchases than they receive deposits, on chequing
 * accounts and on cards. 60 positive to 2 negative is a card statement;
 * 40 negative to 2 positive is a chequing export. One rule reads both.
 *
 * Returns charges_negative (today's behaviour) whenever the evidence is
 * thin or even. A confident wrong guess is worse than an honest default,
 * because the default is what every existing import already assumes.
 *
 * Never throws: bad input is thin evidence, not an error.
 */
export function detectSignConvention(
  rows: { amountCents: number | null }[],
): { convention: SignConvention; confidence: number } {
  const signed = (rows ?? []).filter(
    (r) => typeof r?.amountCents === "number" && r.amountCents !== 0,
  ) as { amountCents: number }[];

  if (signed.length < MIN_ROWS_FOR_DETECTION) {
    return { convention: "charges_negative", confidence: 0 };
  }

  const positives = signed.filter((r) => r.amountCents > 0).length;
  const negatives = signed.length - positives;
  const majority = Math.max(positives, negatives);
  const confidence = majority / signed.length;

  if (confidence < SIGN_CONFIDENCE_BANNER) {
    return { convention: "charges_negative", confidence };
  }
  return {
    convention: positives > negatives ? "charges_positive" : "charges_negative",
    confidence,
  };
}

/**
 * What one amount means under one convention.
 *
 * magnitudeCents is always positive so no caller does sign arithmetic.
 * Zero is income, never an expense: a zero-value deduction is noise.
 *
 * An unrecognised convention degrades to charges_negative rather than
 * throwing. A bad enum must never be able to blank the review page.
 */
export function interpretAmount(
  amountCents: number,
  convention: SignConvention,
): { direction: AmountDirection; magnitudeCents: number } {
  const cents = typeof amountCents === "number" ? amountCents : 0;
  const chargesPositive = convention === "charges_positive";
  const magnitudeCents = Math.abs(cents);

  if (cents === 0) return { direction: "income", magnitudeCents: 0 };
  const isCharge = chargesPositive ? cents > 0 : cents < 0;
  if (isCharge) return { direction: "expense", magnitudeCents };
  return {
    direction: chargesPositive ? "refund" : "income",
    magnitudeCents,
  };
}

export type FlipRow = {
  id: string;
  amountCents: number;
  appliedCategoryCode: string | null;
  appliedExpenseId: string | null;
};

/**
 * What changing the convention does to the rows already in an import.
 *
 * Three buckets, and the ordering of the checks is the whole point:
 *
 *   needsReview  already booked into monthly_expenses. NEVER modified.
 *                Returned so the UI can list them for explicit un-apply.
 *   clearTag     categorized but not booked, and the direction changes.
 *                A "Supplies" pick on a row that is now a refund is
 *                meaningless, so the row returns to the candidate list.
 *   reinterpret  everything else. Nothing to write; it just reads
 *                differently now.
 *
 * A booked row is checked FIRST and unconditionally, so no later branch
 * can reach monthly_expenses. That table is a filed-deduction surface.
 *
 * A no-op flip (from === to) puts everything in reinterpret rather than
 * churning tags for no reason.
 */
export function planFlip(
  rows: FlipRow[],
  from: SignConvention,
  to: SignConvention,
): { reinterpret: string[]; clearTag: string[]; needsReview: string[] } {
  const reinterpret: string[] = [];
  const clearTag: string[] = [];
  const needsReview: string[] = [];

  for (const r of rows ?? []) {
    if (from === to) {
      reinterpret.push(r.id);
      continue;
    }
    if (r.appliedExpenseId) {
      needsReview.push(r.id);
      continue;
    }
    const changed =
      interpretAmount(r.amountCents, from).direction !==
        interpretAmount(r.amountCents, to).direction;
    if (changed && r.appliedCategoryCode) clearTag.push(r.id);
    else reinterpret.push(r.id);
  }
  return { reinterpret, clearTag, needsReview };
}
