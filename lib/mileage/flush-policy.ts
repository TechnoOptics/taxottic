/**
 * When should the tracker hand its buffered points to the server?
 *
 * Extracted from native-tracker so the decision can be tested, and
 * because the decision was silently broken for months while the code
 * that expressed it looked correct.
 *
 * THE BUG THIS FIXES. native-tracker has three flush triggers: the
 * location callback (only at FLUSH_AT_POINTS), a setInterval every
 * FLUSH_EVERY_MS, and a startup drain. A backgrounded WebView freezes
 * timers while still delivering native location callbacks, so in the
 * background the interval never fires and the point threshold is the
 * only trigger left.
 *
 * Parked, points arrive about every 70 seconds, so 40 points is 47
 * minutes of silence. Measured on 2026-08-09: eleven stalls in one day,
 * the longest 152 minutes, and the batch that landed at 23:54 held
 * exactly 40 points after exactly a 47 minute gap.
 *
 * The old comment on these constants already said "flush when either
 * threshold trips", and FLUSH_EVERY_MS was cut from 2 minutes to 30
 * seconds specifically so a drive's points would reach the server WHILE
 * the drive was happening. Both statements were true of the intent and
 * false of the behaviour, because the mechanism enforcing the elapsed
 * half was a timer that does not run when it matters.
 *
 * So the elapsed test lives here and is evaluated on wall clock by the
 * caller, from the location callback, which is the one thing that keeps
 * running in the background. Same correction as lib/mileage/
 * heartbeat-timer.ts, one layer down.
 */

/**
 * Flush once this many points are pending.
 *
 * Historically the ONLY trigger that worked in the background, which is
 * why it reads as the primary rule. It is now the backstop: the elapsed
 * test fires first in every realistic cadence.
 */
export const FLUSH_AT_POINTS = 40;

/**
 * Flush once this much wall clock has passed since the last flush.
 *
 * Dropped from 120_000 to 30_000 in the May 25 2026 rebuild so a real
 * drive's points hit the server while the drive is happening. The
 * previous cadence meant a 4 minute drive finished before the device
 * ever called ingest, so nothing got staged and the tail-close trick
 * that materialises in-progress trips never ran. 30 s also keeps
 * staging to trip latency tight enough to demo: park, open /mileage,
 * see the trip within a minute.
 */
export const FLUSH_EVERY_MS = 30_000;

/**
 * Largest number of points in a single POST to /api/mileage/ingest.
 *
 * Lives here, and is shared by the JS flush loop and by both native
 * buffer drains, because they all post to the same endpoint and the
 * limit is a property of the request rather than of any one caller.
 *
 * Why there is a limit at all: a 179 KB body silently broke every flush
 * on a real handset. Proven on a Galaxy Z Fold5: a small POST returned
 * 200, the same 179 KB body with keepalive threw, and without keepalive
 * returned normally. The fix was two-fold: drop keepalive (durability is
 * already covered by the persisted buffer plus retry) and cap each POST
 * so a large backlog drains in steady chunks instead of one oversized
 * request. 800 points is roughly 70 KB, comfortably small.
 *
 * It binds harder on a drain than on a flush. The JS buffer has never
 * been observed above 266 points, while single inserts from the native
 * drain path of 3764, 2289, 2264 and 1630 points exist in production.
 * Those were the uncapped path.
 */
export const UPLOAD_BATCH_MAX = 800;

/**
 * Are there points worth sending right now?
 *
 * Pure, so the policy can be reasoned about without a WebView, a timer,
 * or a phone.
 *
 * `msSinceLastFlush` is wall clock and can therefore go backwards if the
 * device clock moves. A negative elapsed is treated as not due rather
 * than overdue: the point threshold still covers a growing buffer, and
 * reading a backwards jump as "overdue" would post on every callback
 * until the clock caught up.
 */
export function shouldFlush(args: {
  bufferLength: number;
  msSinceLastFlush: number;
}): boolean {
  const { bufferLength, msSinceLastFlush } = args;
  // Nothing pending. A session-end flush with an empty buffer is a
  // separate case handled inside flush() itself, because it exists to
  // close the trip rather than to move points.
  if (bufferLength < 1) return false;
  if (bufferLength >= FLUSH_AT_POINTS) return true;
  return msSinceLastFlush >= FLUSH_EVERY_MS;
}
