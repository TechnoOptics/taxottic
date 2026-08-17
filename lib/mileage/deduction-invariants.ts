/**
 * Rows that should be impossible, stated as rules a machine can check.
 *
 * WHY THIS EXISTS. On 2026-08-15 a read-only audit of every trip found
 * exactly two rows that violate the tax rules the pipeline is built on:
 *
 *   personal trip carrying $9.61   13.262 mi x 72.5c, the BUSINESS rate,
 *                                  kept after a human reclassified it
 *                                  personal on 2026-07-01
 *   unconfirmed guess carrying $8.09  10.645 mi x 76c, still awaiting the
 *                                  driver's confirmation
 *
 * $17.70 in total, which is not the point. The point is that both sat
 * there unnoticed and would have been carried into a Schedule C, and
 * that NOTHING in the system was capable of noticing. Every write path
 * was already correct; there was simply no reader asking the question.
 *
 * That is the same shape as everything else found that day: the failure
 * was not a wrong calculation, it was an absent check.
 *
 * WHY NOT A DATABASE CONSTRAINT. A CHECK constraint is the strongest
 * option and the wrong first move: it converts a silent bad row into a
 * failed write, and the writers are finalize, the stitch cron and
 * reclassify, all of which run unattended. Turning a $9.61 discrepancy
 * into a crashed mileage pipeline is a worse outcome than the
 * discrepancy. Detect first, and only enforce once the detector has been
 * quiet for a while.
 *
 * Pure functions over plain rows, so the rules are testable without a
 * database and can be run from a cron, a script, or a test.
 */

export type TripRow = {
  id: string;
  classification: string | null;
  needs_confirmation: boolean | null;
  deduction_cents: number | null;
  distance_miles: number | string | null;
};

export type ViolationKind =
  /** Personal miles are not deductible. Full stop. */
  | "personal_with_deduction"
  /** A machine guess the driver has not confirmed must not claim money. */
  | "unconfirmed_with_deduction"
  /** Unclassified means undecided, which cannot carry a claim. */
  | "unclassified_with_deduction"
  /** The user was riding, not driving. Never deductible. */
  | "passenger_with_deduction"
  /** A negative deduction is not a conservative error, it is nonsense. */
  | "negative_deduction";

export type Violation = {
  tripId: string;
  kind: ViolationKind;
  cents: number;
  /** One line naming the rule broken, for a log or an alert. */
  detail: string;
};

/**
 * Check one trip.
 *
 * Deliberately returns EVERY rule a row breaks rather than the first.
 * A row that is both personal and negative has two different things
 * wrong with it, and reporting one would hide the other, which is the
 * failure mode this whole module exists to end.
 */
export function checkTrip(t: TripRow): Violation[] {
  const out: Violation[] = [];
  const cents = t.deduction_cents ?? 0;
  const cls = t.classification;

  if (cents < 0) {
    out.push({
      tripId: t.id,
      kind: "negative_deduction",
      cents,
      detail: `Deduction is negative (${cents} cents).`,
    });
  }

  // Only positive claims can violate the rules below: a zeroed row is
  // exactly what the rules ask for, so flagging cents === 0 would make
  // the detector fire on every correctly handled trip.
  if (cents > 0) {
    if (cls === "personal") {
      out.push({
        tripId: t.id,
        kind: "personal_with_deduction",
        cents,
        detail:
          `Personal trip claims ${cents} cents. Personal miles are not ` +
          `deductible; the likely cause is a business deduction left in ` +
          `place when a human reclassified the drive.`,
      });
    }
    if (cls === "passenger") {
      out.push({
        tripId: t.id,
        kind: "passenger_with_deduction",
        cents,
        detail:
          `Passenger trip claims ${cents} cents. The user was riding, not ` +
          `driving, so no mileage is theirs to deduct. The likely cause is ` +
          `a deduction left in place when the drive was reclassified.`,
      });
    }
    if (cls === "unclassified") {
      out.push({
        tripId: t.id,
        kind: "unclassified_with_deduction",
        cents,
        detail:
          `Unclassified trip claims ${cents} cents. Undecided cannot be ` +
          `a claim.`,
      });
    }
    if (t.needs_confirmation === true) {
      out.push({
        tripId: t.id,
        kind: "unconfirmed_with_deduction",
        cents,
        detail:
          `Trip still awaiting driver confirmation claims ${cents} cents. ` +
          `A machine guess must not become a deduction before a human ` +
          `agrees with it.`,
      });
    }
  }

  return out;
}

export function checkTrips(rows: readonly TripRow[]): Violation[] {
  return rows.flatMap(checkTrip);
}

/**
 * The deduction a violating row SHOULD carry.
 *
 * Only ever returns 0, and only for rows that already violate a rule.
 * It deliberately cannot compute a larger number: a repair path that can
 * INCREASE a deduction is a fabrication path, and the one thing worse
 * than an overstated claim is an automated system that creates them.
 * Every correction this can propose is downward.
 */
export function correctedCents(v: Violation): 0 {
  void v;
  return 0;
}

/** One line for a log or an alert, worst first by value. */
export function summarize(violations: readonly Violation[]): string {
  if (violations.length === 0) return "ok";
  const total = violations.reduce((s, v) => s + Math.abs(v.cents), 0);
  const byKind = new Map<ViolationKind, number>();
  for (const v of violations) {
    byKind.set(v.kind, (byKind.get(v.kind) ?? 0) + 1);
  }
  const parts = [...byKind.entries()].map(([k, n]) => `${k}=${n}`);
  return `${violations.length} violation(s), ${(total / 100).toFixed(2)} USD: ${parts.join(",")}`;
}
