/**
 * Education credits — IRC § 25A.
 *
 * Two flavors, claimed on Form 8863:
 *
 *   American Opportunity Tax Credit (§ 25A(b)) — the better credit
 *   when the student qualifies. 100% of the first $2,000 of qualified
 *   expenses + 25% of the next $2,000 = maximum $2,500 per student.
 *   Forty percent of the credit is REFUNDABLE (up to $1,000 in cash
 *   back if the credit exceeds tax owed). Eligibility (we ask the
 *   user to confirm via the claim_aotc checkbox):
 *     - Student is in the first 4 years of post-secondary education
 *     - Enrolled at least half-time for at least one academic period
 *     - No felony drug conviction
 *     - AOTC hasn't been claimed for the student in any 4 prior years
 *
 *   Lifetime Learning Credit (§ 25A(c)) — broader eligibility, smaller
 *   ceiling. 20% of up to $10,000 of qualified expenses = maximum
 *   $2,000 PER RETURN (not per student). Non-refundable. Available
 *   for any post-secondary education including job-skill courses;
 *   no degree-seeking requirement, no four-year limit.
 *
 * Phase-out thresholds (both credits use the same range — these are
 * statutory and NOT inflation-adjusted, frozen since TCJA):
 *   Single / HoH / Qualifying Widow / MFS:  $80,000  →  $90,000
 *   MFJ:                                    $160,000 → $180,000
 *
 *   Linear phase-out: credit × max(0, 1 - (MAGI - lower) / 10000)
 *   MFJ uses 20000 instead of 10000 in the denominator (the doubled
 *   $160k → $180k range).
 *
 * Married-filing-separately filers are NOT eligible for either credit
 * (statutory disqualifier; no separated-spouse exception).
 *
 * One credit per student per year - we don't yet collect per-student
 * detail, so we treat the qualified_education_expenses_cents input
 * as belonging to a single student and pick AOTC or LLC based on the
 * claim_aotc flag. Users with multiple students should sum their
 * expenses; the LLC's "$10,000 per return" cap means more-than-one
 * student doesn't usually unlock more credit there. Real per-student
 * AOTC handling is a future enhancement.
 */

import type { FilingStatus } from "../constants-2025";

const AOTC_FIRST_TIER_CAP_CENTS = 2_000 * 100;
const AOTC_SECOND_TIER_CAP_CENTS = 2_000 * 100;
const AOTC_REFUNDABLE_FRACTION = 0.4;

const LLC_EXPENSE_CAP_CENTS = 10_000 * 100;
const LLC_RATE = 0.2;

const PHASEOUT_RANGE_SINGLE_CENTS = 10_000 * 100;
const PHASEOUT_RANGE_MFJ_CENTS = 20_000 * 100;

function phaseoutThreshold(filingStatus: FilingStatus): {
  start: number;
  range: number;
} {
  if (
    filingStatus === "married_filing_jointly" ||
    filingStatus === "qualifying_widow"
  ) {
    return { start: 160_000 * 100, range: PHASEOUT_RANGE_MFJ_CENTS };
  }
  // Single, HoH, MFS all share the lower phase-out (MFS is disqualified
  // outright before we reach this helper).
  return { start: 80_000 * 100, range: PHASEOUT_RANGE_SINGLE_CENTS };
}

/**
 * Compute the AOTC and split into refundable + non-refundable portions.
 *
 * Returns 0/0 with reasonZero when the user is disqualified (MFS, no
 * expenses, AGI above completed phase-out, etc.).
 */
function computeAotc(args: {
  qualifiedExpensesCents: number;
  modifiedAgiCents: number;
  filingStatus: FilingStatus;
}): {
  refundableCents: number;
  nonRefundableCents: number;
  reasonZero: string | null;
} {
  if (args.qualifiedExpensesCents <= 0) {
    return { refundableCents: 0, nonRefundableCents: 0, reasonZero: null };
  }
  if (args.filingStatus === "married_filing_separately") {
    return {
      refundableCents: 0,
      nonRefundableCents: 0,
      reasonZero:
        "Education credits aren't available for married-filing-separately filers.",
    };
  }

  // 100% of first $2,000, then 25% of next $2,000.
  const firstTier = Math.min(
    args.qualifiedExpensesCents,
    AOTC_FIRST_TIER_CAP_CENTS,
  );
  const secondTier = Math.min(
    Math.max(0, args.qualifiedExpensesCents - AOTC_FIRST_TIER_CAP_CENTS),
    AOTC_SECOND_TIER_CAP_CENTS,
  );
  let credit = firstTier + Math.round(secondTier * 0.25);

  // AGI phase-out (modified AGI ≈ AGI for most filers; we don't
  // recompute the small foreign-earned-income add-back).
  const { start, range } = phaseoutThreshold(args.filingStatus);
  if (args.modifiedAgiCents >= start + range) {
    return {
      refundableCents: 0,
      nonRefundableCents: 0,
      reasonZero: `AOTC phases out completely at MAGI of $${((start + range) / 100).toLocaleString()} for your filing status; you're at $${(args.modifiedAgiCents / 100).toLocaleString()}.`,
    };
  }
  if (args.modifiedAgiCents > start) {
    const phaseFrac = 1 - (args.modifiedAgiCents - start) / range;
    credit = Math.round(credit * phaseFrac);
  }

  // Split into refundable and non-refundable.
  const refundable = Math.round(credit * AOTC_REFUNDABLE_FRACTION);
  const nonRefundable = credit - refundable;
  return {
    refundableCents: refundable,
    nonRefundableCents: nonRefundable,
    reasonZero: null,
  };
}

/**
 * Compute the Lifetime Learning Credit. Always non-refundable.
 */
function computeLlc(args: {
  qualifiedExpensesCents: number;
  modifiedAgiCents: number;
  filingStatus: FilingStatus;
}): {
  nonRefundableCents: number;
  reasonZero: string | null;
} {
  if (args.qualifiedExpensesCents <= 0) {
    return { nonRefundableCents: 0, reasonZero: null };
  }
  if (args.filingStatus === "married_filing_separately") {
    return {
      nonRefundableCents: 0,
      reasonZero:
        "Education credits aren't available for married-filing-separately filers.",
    };
  }

  // 20% of up to $10,000 of expenses.
  const baseExpenses = Math.min(
    args.qualifiedExpensesCents,
    LLC_EXPENSE_CAP_CENTS,
  );
  let credit = Math.round(baseExpenses * LLC_RATE);

  const { start, range } = phaseoutThreshold(args.filingStatus);
  if (args.modifiedAgiCents >= start + range) {
    return {
      nonRefundableCents: 0,
      reasonZero: `Lifetime Learning Credit phases out completely at MAGI of $${((start + range) / 100).toLocaleString()} for your filing status; you're at $${(args.modifiedAgiCents / 100).toLocaleString()}.`,
    };
  }
  if (args.modifiedAgiCents > start) {
    const phaseFrac = 1 - (args.modifiedAgiCents - start) / range;
    credit = Math.round(credit * phaseFrac);
  }

  return { nonRefundableCents: credit, reasonZero: null };
}

/**
 * Top-level dispatcher: the user picks AOTC or LLC via the
 * `claim_aotc` flag, we route the math accordingly.
 */
export function computeEducationCreditCents(args: {
  qualifiedExpensesCents: number;
  modifiedAgiCents: number;
  filingStatus: FilingStatus;
  claimAotc: boolean;
}): {
  refundableCents: number;
  nonRefundableCents: number;
  /** "aotc" | "llc" | "none" - useful for the tile copy. */
  kind: "aotc" | "llc" | "none";
  reasonZero: string | null;
} {
  if (args.qualifiedExpensesCents <= 0) {
    return {
      refundableCents: 0,
      nonRefundableCents: 0,
      kind: "none",
      reasonZero: null,
    };
  }

  if (args.claimAotc) {
    const aotc = computeAotc(args);
    if (
      aotc.refundableCents + aotc.nonRefundableCents === 0 &&
      aotc.reasonZero
    ) {
      return {
        refundableCents: 0,
        nonRefundableCents: 0,
        kind: "none",
        reasonZero: aotc.reasonZero,
      };
    }
    return {
      refundableCents: aotc.refundableCents,
      nonRefundableCents: aotc.nonRefundableCents,
      kind: "aotc",
      reasonZero: null,
    };
  }

  const llc = computeLlc(args);
  if (llc.nonRefundableCents === 0 && llc.reasonZero) {
    return {
      refundableCents: 0,
      nonRefundableCents: 0,
      kind: "none",
      reasonZero: llc.reasonZero,
    };
  }
  return {
    refundableCents: 0,
    nonRefundableCents: llc.nonRefundableCents,
    kind: "llc",
    reasonZero: null,
  };
}
