/**
 * Device-clock correction for an incoming batch of GPS fixes.
 *
 * Extracted from app/api/mileage/ingest so the rule can be tested
 * directly. The previous version lived inline in the route, which is why
 * the defect below survived: every test drove the segmenter with
 * already-corrected points and none of them exercised the correction.
 *
 * WHY CORRECT AT ALL
 *
 * Two device-clock failures reach us, and both are a CONSTANT offset
 * across a contemporaneous batch:
 *
 *  - Clock AHEAD: a future captured_at makes the finalizer's parked test
 *    (server now - device ts) read negative, so the drive never
 *    tail-closes. Pinning every skewed point to the identical receipt
 *    instant collapses the batch to one timestamp, and renderTripFromRaw's
 *    by-time dedupe then keeps ONE point per batch, silently deleting the
 *    drive's shape (audit #14).
 *  - Clock BEHIND: every point looks minutes old on arrival, so the parked
 *    test fires on a live drive and force-closes it every ingest,
 *    shredding one drive into fragments (audit #13).
 *
 * Shifting the whole batch by one offset fixes both while preserving
 * relative spacing, which is the thing that makes a track a track.
 *
 * WHY THE OFFSET MUST NOT REACH THE WHOLE BATCH
 *
 * The guard used to be computed from the batch's NEWEST point and then
 * applied to EVERY point. A batch is not always contemporaneous: the
 * device buffers while offline and a later flush can carry hours of
 * backlog ALONGSIDE one fresh fix. The fresh fix sets the skew, the
 * fresh fix passes the "small lag, so it is clock drift" test, and the
 * hours-old backlog behind it is then dragged forward by up to 30
 * minutes.
 *
 * That is not theoretical. Production carries one such incident: 203
 * distinct coordinates re-delivered at a constant +1157s, and the
 * arithmetic identifies the shift as the cause without ambiguity.
 * Writing copy A at its true time and copy B at true+1157s defeats the
 * (driver, company, captured_at) idempotency key that the staging upsert
 * relies on, so what should have been a no-op re-flush became a second
 * copy of the drive.
 *
 * So the offset now applies only to points in the same TIME CLUSTER as
 * the newest one. Backlog keeps the timestamps the device recorded.
 *
 * This is deliberately asymmetric, because the two mistakes are not
 * equally bad. Failing to correct a genuinely skewed old point leaves a
 * stale row whose drive the mileage-finalize cron closes anyway.
 * Correcting a backlog point that was never skewed fabricates mileage,
 * and fabricated mileage is a false record of a tax position. When the
 * evidence is ambiguous, leave the record alone.
 */

/** Beyond this, a lag is a real offset and not network jitter. */
export const SKEW_TOLERANCE_MS = 2 * 60_000;

/**
 * A true clock offset is seconds to minutes. A batch HOURS or days behind
 * receipt is not a broken clock, it is an OFFLINE BACKLOG finally
 * flushing, and its timestamps are correct. Shifting a backlog relabels
 * old drives as "now" and interleaves them with tonight's points into
 * fabricated mega-trips (observed live: two impossible trips, 808 mi and
 * 314 mi, 21-mile hops at 1-minute spacing, after a 2-day-dark phone
 * flushed its buffer).
 */
export const MAX_BEHIND_SHIFT_MS = 30 * 60_000;

/**
 * How far back from the newest point a fix may sit and still count as
 * part of the same contemporaneous batch.
 *
 * Same value as MAX_BEHIND_SHIFT_MS, for one reason rather than by
 * coincidence: a lag we would refuse to call clock drift when the WHOLE
 * batch showed it does not become clock drift because a fresher point
 * happens to be travelling with it.
 */
export const CLUSTER_WINDOW_MS = MAX_BEHIND_SHIFT_MS;

export type SkewInput = { ts: number };

export type SkewResult<T extends SkewInput> = {
  points: T[];
  /** Offset detected from the newest point. Negative means clock behind. */
  skewMs: number;
  /** Whether the offset was judged a clock error at all. */
  shifted: boolean;
  /** Points left alone because they were backlog, not contemporaneous. */
  backlogHeld: number;
};

/**
 * Correct a batch's device-clock offset, returning points in ascending
 * time order.
 *
 * `receiptMs` is passed in rather than read from Date.now() so the rule
 * is testable and so a single request cannot disagree with itself.
 */
export function correctBatchClockSkew<T extends SkewInput>(
  finite: T[],
  receiptMs: number,
): SkewResult<T> {
  const newestTs = finite.reduce((a, pt) => Math.max(a, pt.ts), 0);
  const skewMs = newestTs > 0 ? newestTs - receiptMs : 0;

  const shifted =
    // Ahead of receipt is physically impossible: always a clock issue.
    skewMs > SKEW_TOLERANCE_MS ||
    // Behind is ambiguous: only treat SMALL lags as clock skew.
    (skewMs < -SKEW_TOLERANCE_MS && skewMs > -MAX_BEHIND_SHIFT_MS);

  let backlogHeld = 0;
  const points = (
    shifted
      ? finite.map((pt) => {
          // Contemporaneous with the point that set the skew?
          if (newestTs - pt.ts <= CLUSTER_WINDOW_MS) {
            return { ...pt, ts: pt.ts - skewMs };
          }
          backlogHeld++;
          return pt;
        })
      : finite
  ).sort((a, b) => a.ts - b.ts);

  return { points, skewMs, shifted, backlogHeld };
}
