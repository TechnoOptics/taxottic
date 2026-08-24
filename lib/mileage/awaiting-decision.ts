import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Which drives are still waiting on a decision from the driver.
 *
 * ## The gap this closes
 *
 * /mileage counted only `classification = 'unclassified'`. That is one of
 * the two ways a drive can be undecided, and by August 2026 it was much
 * the rarer one. The other is a drive the machine classified on its own
 * with `needs_confirmation = true`: no saved place matched, so the call
 * is a guess. #616 removed those from the Schedule C headline, correctly,
 * because a machine guess must not become a tax figure before a human
 * agrees with it. Nothing was added to tell the driver a decision was
 * being waited on, so the product quietly withheld the deduction and
 * never asked.
 *
 * Production on 2026-08-24: one unclassified drive across the whole
 * fleet, and sixteen carrying needs_confirmation. Of those, five belonged
 * to one driver and had all started that day. Both reporting drivers saw
 * "Need review: 0 · All caught up".
 *
 * ## Why the count ignores the page's date range
 *
 * /mileage defaults to `range=day`. The other reporting driver held ten
 * pending drives, the newest from the day before, so a range-scoped count
 * showed zero on the view they land on. "The drives that have not been
 * coded should always show" is the request, and always means regardless
 * of which range pill happens to be selected.
 *
 * ## Why one number and not a breakdown
 *
 * Both states ask the driver for the same thing, the review deck presents
 * them identically, and one server action settles either. Splitting the
 * badge would describe an implementation detail rather than a task.
 *
 * ## No money here, deliberately
 *
 * The count is a count. #617 measured seventeen pending drives holding
 * 173.8 miles but only $33.89, because most carry no computed deduction
 * at all: the flag is written alongside a zeroed `deduction_cents`.
 * Quoting that sum against those miles reads as nineteen cents a mile and
 * understates what confirming them is actually worth.
 */

/** The PostgREST disjunction. Exported so the count and the review deck
 *  provably apply the same one; see awaiting-decision.test.ts. */
export const AWAITING_DECISION_OR =
  "classification.eq.unclassified,needs_confirmation.is.true";

export type DecidableTrip = {
  classification: string | null;
  needs_confirmation: boolean | null;
};

/**
 * The in-memory statement of the same policy.
 *
 * `needs_confirmation === true` and not merely truthy, for the reason
 * lib/mileage/schedule-c-totals.ts records: a column PostgREST was never
 * asked for comes back `undefined` rather than raising, and the direction
 * of the default has to survive that. NULL means a row written before the
 * confirmation migration, which is settled, not pending. Defaulting the
 * other way would drop 119 production rows into the queue.
 */
export function isAwaitingDecision(t: DecidableTrip): boolean {
  if (t.classification === "passenger") return false;
  return t.classification === "unclassified" || t.needs_confirmation === true;
}

/**
 * The call the machine already made on a drive that is awaiting
 * confirmation, or null when nothing has been decided.
 *
 * The review deck needs this to be honest. Two of the three pending
 * production drives on the reporting account are already labelled
 * business in the trip list, and putting them in a deck that asks
 * "business or personal?" with no acknowledgement of the existing label
 * invites the reasonable question "I thought I already had this one".
 * The deck says which call it is confirming instead.
 */
export function assumedCall(t: DecidableTrip): "business" | "personal" | null {
  if (t.needs_confirmation !== true) return null;
  if (t.classification === "business" || t.classification === "personal")
    return t.classification;
  return null;
}

/**
 * The two builder methods this filter needs.
 *
 * Deliberately NOT expressed as `<Q extends Filterable<Q>>`. PostgREST's
 * builder type is self-referential and generic in five parameters, and
 * resolving it against a recursive constraint makes tsc give up with
 * TS2589 ("type instantiation is excessively deep"). The cast below
 * hands the caller's own type straight back, so the call sites stay
 * fully typed, and what the cast gives up is checked instead by the
 * fake builder in awaiting-decision.test.ts, which applies these exact
 * calls to a fixture and asserts on the surviving rows.
 */
type Filterable = {
  neq(col: string, val: unknown): Filterable;
  or(expr: string): Filterable;
};

/**
 * Narrow a mileage_trips query to the drives awaiting a decision.
 *
 * Passenger is excluded first and explicitly. `reclassifyTripCore` clears
 * the flag on every write, so a flagged passenger row should not exist,
 * but "I was a passenger" is a decision the driver already made and the
 * one thing a review queue must never do is ask again about a drive that
 * has been answered.
 */
export function applyAwaitingDecisionFilter<Q>(q: Q): Q {
  return (q as Filterable)
    .neq("classification", "passenger")
    .or(AWAITING_DECISION_OR) as Q;
}

/**
 * How many of this driver's drives are waiting on them, across every
 * company and every date.
 *
 * A single `head` request for an exact count, so it costs one round trip
 * and no payload. The page issues it inside the existing parallel read
 * group, which pays the slowest member rather than the sum, and both
 * halves are index-supported (`mileage_trips_driver_idx` and the partial
 * `mileage_trips_needs_confirmation_idx`).
 *
 * Scoped by `driver_user_id` alone, matching /mileage/classify's own
 * query: a drive belongs to the person who drove it, not to whichever
 * company membership the page happens to be rendering.
 */
export async function countDrivesAwaitingDecision(
  admin: SupabaseClient,
  driverUserId: string,
): Promise<number> {
  const { count, error } = await applyAwaitingDecisionFilter(
    admin.from("mileage_trips").select("id", { count: "exact", head: true }),
  ).eq("driver_user_id", driverUserId);

  // A badge that cannot be sized is a badge that reads zero. It is never
  // an error page for somebody who only opened their drive log.
  if (error) {
    console.error("[awaiting-decision] count failed", error.message);
    return 0;
  }
  return count ?? 0;
}
