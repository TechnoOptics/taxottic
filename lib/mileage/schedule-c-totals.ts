/**
 * Which business drives belong in a Schedule C total, and which do not.
 *
 * WHY THIS IS A MODULE AND NOT THREE LINES IN A PAGE. On 2026-08-22 an
 * audit of production found two drives carrying 33.89 USD inside the
 * "Mileage deduction" figure on /mileage/business, a figure that page
 * describes in its own header comment as "the Schedule C numbers".
 * Both were drives the app had classified as business on its own, with
 * `needs_confirmation = true`, which the driver had never agreed with.
 *
 * The page filtered on classification and never looked at the
 * confirmation flag, so a machine guess was being presented as a tax
 * figure. The rule that catches it, in lib/mileage/deduction-invariants
 * .ts, is "a machine guess must not become a deduction before a human
 * agrees with it". It is the same rule; this is the read side of it.
 *
 * A pure function over plain rows, so the split can be tested without
 * a database, a session or a rendered page. The page is a server
 * component and the alternative was leaving a money rule untestable.
 */

export type ClassifiableTrip = {
  distance_miles: number | string | null;
  deduction_cents: number | null;
  needs_confirmation: boolean | null;
};

export type ScheduleCSplit = {
  /** Confirmed business drives. These are the Schedule C numbers. */
  settledCount: number;
  settledMiles: number;
  settledCents: number;
  /** Machine guesses the driver has not confirmed. Shown separately. */
  pendingCount: number;
  pendingMiles: number;
  pendingCents: number;
};

const EMPTY: ScheduleCSplit = {
  settledCount: 0,
  settledMiles: 0,
  settledCents: 0,
  pendingCount: 0,
  pendingMiles: 0,
  pendingCents: 0,
};

/**
 * A row is pending only when `needs_confirmation` is EXACTLY true.
 *
 * What actually matters here is the DIRECTION of the default: rows
 * written before the confirmation migration carry NULL, and those are
 * settled drives rather than pending ones. Defaulting the other way
 * would empty the headline deduction for every account older than that
 * migration, which is this bug pointed the other way.
 *
 * For a `boolean | null` column, `=== true` and a plain truthiness
 * check agree on all three values, so the strict form is defensive
 * rather than load-bearing: it keeps the direction correct if the
 * column ever arrives as something other than a boolean, which is how
 * PostgREST behaves for a column that was never selected. That case is
 * the one worth guarding, because a field the query forgot to ask for
 * comes back `undefined` rather than raising, and the query is checked
 * separately in the test beside this file.
 */
export function isAwaitingConfirmation(t: ClassifiableTrip): boolean {
  return t.needs_confirmation === true;
}

/** Accumulate a set of business drives into the two buckets. */
export function splitScheduleC(
  trips: readonly ClassifiableTrip[],
): ScheduleCSplit {
  return trips.reduce<ScheduleCSplit>((acc, t) => {
    const miles = Number(t.distance_miles ?? 0) || 0;
    const cents = Number(t.deduction_cents ?? 0) || 0;
    if (isAwaitingConfirmation(t)) {
      return {
        ...acc,
        pendingCount: acc.pendingCount + 1,
        pendingMiles: acc.pendingMiles + miles,
        pendingCents: acc.pendingCents + cents,
      };
    }
    return {
      ...acc,
      settledCount: acc.settledCount + 1,
      settledMiles: acc.settledMiles + miles,
      settledCents: acc.settledCents + cents,
    };
  }, EMPTY);
}

/** Fold one page of a paged sweep into a running split. */
export function mergeScheduleC(
  a: ScheduleCSplit,
  b: ScheduleCSplit,
): ScheduleCSplit {
  return {
    settledCount: a.settledCount + b.settledCount,
    settledMiles: a.settledMiles + b.settledMiles,
    settledCents: a.settledCents + b.settledCents,
    pendingCount: a.pendingCount + b.pendingCount,
    pendingMiles: a.pendingMiles + b.pendingMiles,
    pendingCents: a.pendingCents + b.pendingCents,
  };
}

export const EMPTY_SPLIT = EMPTY;
