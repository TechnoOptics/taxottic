/**
 * Actually run the deduction invariants against real rows.
 *
 * WHY THIS EXISTS. lib/mileage/deduction-invariants.ts was written on
 * 2026-08-15 after an audit found two trips carrying a deduction they
 * were not entitled to. Its header says the point was that both "sat
 * there unnoticed and would have been carried into a Schedule C, and
 * that NOTHING in the system was capable of noticing".
 *
 * The detector was written, reviewed, tested and merged. Nothing ever
 * called it. `checkTrip` and `checkTrips` had zero callers outside
 * their own test file for a week.
 *
 * On 2026-08-22 the rules were run by hand against production and
 * found two more violating rows, worth 33.89 USD, created on 18 and 20
 * August. So the class recurred within five days of the detector being
 * built, and the detector was incapable of noticing, for the same
 * reason the original rows went unnoticed: nobody was asking.
 *
 * That is the whole lesson of this codebase in one file. A rule nobody
 * evaluates is a comment.
 *
 * WHY IT READS EVERY ROW WITH A DEDUCTION, RATHER THAN A RECENT WINDOW
 *
 * A recency window is the obvious cost saving and it is wrong here.
 * The two live violations are days old. A window short enough to be
 * cheap would step past them, and they would stay invisible forever
 * precisely because they are old, which is the failure this file
 * exists to end. A violation does not age out.
 *
 * The scan is bounded instead by the rule itself: only a row with a
 * non-zero deduction can violate anything, because every rule below
 * `cents > 0` needs a positive claim and the negative rule needs a
 * negative one. That is a small fraction of the table and it grows
 * with claimed drives rather than with GPS volume.
 *
 * WHY IT NEVER THROWS
 *
 * The caller is the finalize cron, whose job is turning points into
 * trips. An audit that cannot read must not stop mileage being
 * recorded. It reports what it managed to check, and says so when it
 * could not check everything.
 */

import { checkTrips, summarize, type TripRow, type Violation } from "./deduction-invariants";

/** PostgREST caps a single response at 1000 rows. */
const PAGE = 1000;

/**
 * Refuse to scan forever. If a schema change ever makes the candidate
 * filter match the whole table, this stops the cron from reading it
 * all rather than timing out, and `complete: false` says so out loud.
 */
const MAX_PAGES = 25;

export type DeductionAudit = {
  /** Rows actually examined. */
  scanned: number;
  /** Every rule every scanned row breaks. */
  violations: Violation[];
  /** One line for the log, worst first by value. */
  summary: string;
  /**
   * False when the scan stopped early, from a read error or the page
   * cap. A partial clean result is NOT evidence of a clean table, and
   * naming it separately keeps those two apart.
   */
  complete: boolean;
};

type Queryable = {
  from: (table: string) => {
    select: (cols: string) => {
      or: (filter: string) => {
        order: (
          col: string,
          opts: { ascending: boolean },
        ) => {
          range: (
            from: number,
            to: number,
          ) => Promise<{ data: unknown[] | null; error: unknown }>;
        };
      };
    };
  };
};

/**
 * Scan every trip that carries a deduction and report the rules broken.
 *
 * `admin` is passed in rather than constructed so this adds no
 * privileged call site of its own, and so the rules can be exercised
 * against a fake in tests.
 */
export async function auditDeductions(
  admin: unknown,
  log: (line: string) => void = console.warn,
): Promise<DeductionAudit> {
  const db = admin as Queryable;
  const rows: TripRow[] = [];
  let complete = true;

  for (let page = 0; page < MAX_PAGES; page++) {
    const from = page * PAGE;
    let data: unknown[] | null = null;
    let error: unknown = null;

    try {
      ({ data, error } = await db
        .from("mileage_trips")
        // Only a non-zero claim can break any of the rules. A row at
        // zero is exactly what every rule asks for, so scanning them
        // would be work that can never produce a finding.
        .select("id, classification, needs_confirmation, deduction_cents, distance_miles")
        .or("deduction_cents.gt.0,deduction_cents.lt.0")
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1));
    } catch (e) {
      error = e;
    }

    if (error) {
      // Report what we have and mark it partial. A read failure that
      // returned "no violations" would be the most dangerous possible
      // output of this function.
      complete = false;
      log(`[deduction-audit] read failed on page ${page}: ${String(error)}`);
      break;
    }

    const batch = (data ?? []) as TripRow[];
    rows.push(...batch);
    if (batch.length < PAGE) break;

    if (page === MAX_PAGES - 1) {
      complete = false;
      log(
        `[deduction-audit] stopped at the ${MAX_PAGES}-page cap with a full ` +
          `page still returning; the candidate filter is matching far more ` +
          `than it should`,
      );
    }
  }

  const violations = checkTrips(rows);
  const summary = summarize(violations);

  if (violations.length > 0) {
    // One line, greppable, worst first by value. This is the signal a
    // human is meant to see; the trip ids make it actionable without a
    // second query.
    log(
      `[deduction-audit] ${summary} scanned=${rows.length} complete=${complete} ` +
        `trips=${violations.map((v) => v.tripId).join(",")}`,
    );
  }

  return { scanned: rows.length, violations, summary, complete };
}
