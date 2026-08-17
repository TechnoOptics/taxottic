import type { Classification } from "./segmentation";

/**
 * Which classifications are EXCLUDED from the driver's log.
 *
 * "passenger" means the user was riding, not driving. The phone cannot
 * tell the two apart, so the driver has to be able to say so, and once
 * they have, the drive is not theirs: it belongs in no list, on no map,
 * and in no total.
 *
 * ## Why exclude and not delete
 *
 * The row survives. That is deliberate, and the reasons are the same ones
 * recorded in supabase/migrations/20260817010000_mileage_passenger.sql:
 * a hard delete has no undo behind a one-tap control on a phone, it
 * leaves an unexplained hole in the day's GPS trail, and this codebase
 * refuses to fabricate mileage, so quietly destroying captured mileage is
 * the same act pointed the other way.
 *
 * ## Why a partition and not a filter
 *
 * A plain `.filter()` would drop the excluded rows on the floor, and then
 * a mis-tap really would be unrecoverable: the drive would be invisible
 * with no way back. Handing BOTH halves to the caller is what lets
 * /mileage hide the drive from the log while still offering a way to
 * restore it.
 *
 * ## Why totals do not appear here
 *
 * They do not need to. tripDeductionCents() returns 0 for anything that
 * is not "business", and lib/mileage/summary.ts filters
 * `.eq("classification", "business")`, so a passenger drive drops out of
 * every total by the same path a personal one does. This module governs
 * what is SHOWN, nothing else.
 */
const EXCLUDED_FROM_LOG: readonly string[] = ["passenger"];

type ClassifiedRow = { classification?: Classification | string | null };

/**
 * Is this drive excluded from the driver's log?
 *
 * A missing or null classification is NOT excluded. Hiding a drive on the
 * strength of a column that failed to come back would be silent data loss,
 * which is the one thing the mileage pipeline may never do.
 */
export function isExcludedFromLog(row: ClassifiedRow): boolean {
  const cls = row.classification;
  return typeof cls === "string" && EXCLUDED_FROM_LOG.includes(cls);
}

/**
 * Split loaded trips into what the log shows and what it holds back.
 *
 * Order is preserved in both halves (the caller has already sorted by
 * start time) and no row is dropped: every input lands in exactly one
 * half.
 */
export function partitionLoggedTrips<T extends ClassifiedRow>(
  rows: readonly T[],
): { logged: T[]; excluded: T[] } {
  const logged: T[] = [];
  const excluded: T[] = [];
  for (const row of rows) {
    if (isExcludedFromLog(row)) excluded.push(row);
    else logged.push(row);
  }
  return { logged, excluded };
}
