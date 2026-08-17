/**
 * When is a fix in one native buffer already on the server because the
 * SIBLING native buffer just posted it?
 *
 * THE DEFECT this answers. Both native buffers hold the same fix stream,
 * and drainNativeBuffers posted both. Production: two ingest POSTs
 * 0.618 s apart, each carrying exactly 1630 points, all 1630 pairs
 * coordinate-identical and offset by exactly 0.6310 s with standard
 * deviation 0.0000. Ingest is idempotent on
 * (driver_user_id, company_id, captured_at), a 631 ms difference is not
 * a conflict, so BOTH copies stored. Merged with the live stream that
 * pool holds 1263 of 3351 transitions above 60 m/s, worst about
 * 88783 m/s; it segments to a single 1527 mile / 25 minute trip,
 * isPlausibleTrip correctly refuses it, and the drive never appears.
 *
 * WHY NOT DEDUPE ON THE TIMESTAMP
 *
 * Because the 631 ms phase is the whole problem. The two buffers
 * reconstruct their timestamps from different anchors, so the same
 * physical fix carries two different captured_at values and an exact
 * key never collides. That is also why ingest's own idempotency did not
 * save us.
 *
 * WHY THE COORDINATE IS THE IDENTITY
 *
 * Bit-identical latitude AND longitude means the receiver did not move.
 * A moving GPS receiver does not emit the same IEEE double twice, so
 * two fixes matching exactly are two recordings of one standing
 * position, and the second carries no position the server lacks. The
 * comparison is exact on purpose: if a future native build stored its
 * coordinates at a different precision, nothing would match and both
 * batches would post, which is the old behaviour rather than a lost
 * drive. The failure direction is the safe one.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It never looks inside a single batch. The first batch is posted whole
 * and untouched, so a drive's own sample density is never reduced by
 * this module; only the second buffer's copy of fixes the first one
 * already put on the server is dropped.
 */

/** The only three fields identity depends on. */
export type PostedFix = { lat: number; lng: number; ts: number };

/**
 * Was this fix, belonging to this company, already posted by the sibling
 * drain in this same pass?
 */
export type CoverageCheck = (companyId: string, fix: PostedFix) => boolean;

/**
 * How far apart two recordings of one standing position may sit and
 * still be the same fix.
 *
 * The measured phase between the two buffers is 631 ms with standard
 * deviation 0.0000, so anything at or below 631 ms would fail to catch
 * the case this exists for. Three times that leaves room for an anchor
 * that is not bit-stable between the two native services without
 * reaching a span in which a genuinely new observation could hide: the
 * only fixes eligible at all are ones at a bit-identical coordinate,
 * where the device is by definition parked.
 */
export const COVERAGE_WINDOW_MS = 2_000;

/**
 * What the check actually did, so production can say whether it works.
 *
 * This exists because the failure mode of everything above is SILENCE.
 * Identity is the exact coordinate, so a native build that stored its
 * coordinates at a different precision would match nothing, suppress
 * nothing, and leave every other signal in this subsystem looking
 * healthy: a live drain trigger, points moving, no errors anywhere. The
 * dedupe would simply have stopped working and no row would say so.
 *
 * `checked` is what makes `suppressed` legible. Alone, suppressed = 0
 * has two opposite meanings and no way to pick between them:
 *
 *   checked > 0, suppressed > 0   working
 *   checked > 0, suppressed = 0   both buffers held fixes and NOTHING
 *                                 matched. This is the inert signature.
 *   checked = 0                   the mechanism had no opportunity: no
 *                                 confirmed sibling batch, or nothing in
 *                                 the second buffer. Evidence of nothing.
 *
 * A fix counts as checked only when the coverage set could actually have
 * matched it: non-empty, and the same company. Counting a fix that was
 * weighed against an empty set would manufacture the inert signature out
 * of an ordinary upload failure, which is worse than no counter at all.
 */
export type CoverageTally = { checked: number; suppressed: number };

/**
 * Build the check from the batch a drain CONFIRMED on the server, plus
 * the tally the caller reports on the heartbeat.
 *
 * `posted` must be what ingest accepted, never what was read off disk.
 * A refused batch leaves its fixes on disk and puts nothing on the
 * server, so treating a read batch as coverage would delete the only
 * other copy of a drive. Callers pass an empty array in that case and
 * this returns a check that covers nothing and tallies nothing.
 *
 * `companyId` is compared because the two buffers carry their own. The
 * same coordinates under a different company are different rows, so a
 * sibling batch cannot stand in for them.
 *
 * The tally is filled in as the check RUNS, so it is only complete once
 * the consumer has finished with it.
 */
export function coverageOf(
  companyId: string,
  posted: PostedFix[],
): { check: CoverageCheck; tally: CoverageTally } {
  const timesAt = new Map<string, number[]>();
  for (const p of posted) {
    const key = `${p.lat},${p.lng}`;
    const at = timesAt.get(key);
    if (at) at.push(p.ts);
    else timesAt.set(key, [p.ts]);
  }
  const tally: CoverageTally = { checked: 0, suppressed: 0 };
  const check: CoverageCheck = (otherCompanyId, fix) => {
    // Both halves of this gate are the tally's honesty as much as the
    // check's: past here the coverage set could genuinely have matched,
    // so a miss means something.
    if (timesAt.size === 0 || otherCompanyId !== companyId) return false;
    tally.checked += 1;
    const at = timesAt.get(`${fix.lat},${fix.lng}`);
    const hit =
      at !== undefined &&
      at.some((ts) => Math.abs(ts - fix.ts) <= COVERAGE_WINDOW_MS);
    if (hit) tally.suppressed += 1;
    return hit;
  };
  return { check, tally };
}
