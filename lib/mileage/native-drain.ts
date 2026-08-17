/**
 * When does the NATIVE on-disk buffer get emptied?
 *
 * Until this module the answer was "on tracker start, and at no other
 * time". `drainGeofenceBuffer()` and `drainNativeLocationBuffer()` had
 * exactly one caller each, both inside resumeMileageTrackingIfEnabled,
 * so time-to-server for anything the native resurrection path captured
 * was bounded by when the app was next launched rather than by network
 * conditions or OS policy.
 *
 * The measurement, from docs/design/upload-latency.md: over ten days,
 * 48.8 % of points arrived more than 30 minutes after capture, median
 * 160 minutes and p90 24 hours, while 1571 of 1593 batches carried a
 * point captured less than two minutes before receipt. Both statements
 * are true at once because the delay is bimodal, and the slow mode is
 * this buffer. One heartbeat sequence shows it directly:
 * `geofence_buffered_fixes` going 832 to 1512 over 37 minutes with
 * location callbacks firing every second and `buffer_size` at 8.
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES IN native-tracker
 *
 * Because the part that was wrong is the DECISION, and a decision that
 * lives inside a 2200-line file with a WebView, a Capacitor bridge and a
 * setInterval around it cannot be tested. Same reasoning, and the same
 * shape, as ./flush-policy.
 *
 * WHY THE GATE IS WALL CLOCK AND NOT A TIMER
 *
 * A backgrounded WebView freezes setInterval while native location
 * callbacks keep being delivered; this codebase has measured
 * `timer_lag_ms` of fifteen hours. So the drain rides the events that do
 * fire (the location callback, the flush tick, a resume) and each of
 * them asks this module whether enough WALL CLOCK has passed. A drain
 * scheduled on a timer would be dead in exactly the hours it matters.
 */

import { drainGeofenceBuffer } from "./geofence";
import { drainNativeLocationBuffer } from "./device-status";
import { coverageOf, type PostedFix } from "./drain-coverage";

/**
 * Minimum wall clock between drain attempts.
 *
 * A drain is not free: `readBuffer()` reads the whole on-disk JSONL file
 * across the bridge, and the location callback fires roughly once a
 * second while driving. Two minutes keeps the round trip off the hot
 * path while still replacing a bound of "hours, until the next launch"
 * with a bound of "two minutes, while the app is alive at all".
 *
 * Deliberately longer than FLUSH_EVERY_MS (30 s). The JS flush loop
 * moves points that are already in memory; this one crosses the bridge
 * and reads a file, so it does not belong on the same cadence.
 */
export const NATIVE_DRAIN_EVERY_MS = 120_000;

/** Which event actually caused the drain. See nativeDrainDiag. */
export type NativeDrainTrigger = "start" | "resume" | "flush" | "callback";

/**
 * The last drain attempt, reported on the heartbeat.
 *
 * This is the whole observability story for the change and it is
 * deliberately three fields rather than a subsystem. The question it has
 * to answer in production is exactly one question: **is the buffer being
 * drained anywhere other than a cold start?** A row whose
 * `native_drain_trigger` is `flush`, `callback` or `resume` answers yes.
 * `start` on every row, forever, answers no, and would mean this change
 * did not take.
 *
 * `lastPoints` separates "the drain runs and finds nothing" from "the
 * drain never runs", which are indistinguishable from the backlog
 * counter alone and are completely different bugs.
 */
export const nativeDrainDiag = {
  lastTrigger: null as NativeDrainTrigger | null,
  lastAtMs: 0,
  lastPoints: 0,
  /**
   * Fixes the second buffer offered to the duplicate check while a
   * confirmed sibling batch existed to check them against, and how many
   * of those the sibling batch already held.
   *
   * Together these are the only evidence that the duplicate suppression
   * is alive. Identity is the EXACT coordinate, so a native build that
   * stored coordinates at a different precision would match nothing
   * while lastTrigger, lastPoints and every other field stayed healthy.
   * `lastPoints` roughly halving is inference, not evidence, and it is
   * indistinguishable from the driver driving less.
   *
   *   lastChecked > 0, lastSuppressed > 0   working
   *   lastChecked > 0, lastSuppressed = 0   INERT: both buffers held
   *                                         fixes and nothing matched
   *   lastChecked = 0                       no opportunity, says nothing
   *   lastTrigger = null                    the drain never ran at all
   *
   * See ./drain-coverage.
   */
  lastChecked: 0,
  lastSuppressed: 0,
};

let draining = false;
let lastAttemptMs = 0;

/**
 * Empty both native buffers, at most one drain at a time and at most one
 * per NATIVE_DRAIN_EVERY_MS. Returns how many points reached the server.
 *
 * The in-flight guard is load-bearing rather than tidy. Each drain is a
 * read, then a POST, then a native consume, so it stays open across two
 * network round trips. Two overlapping drains read the SAME fixes and
 * post them twice. Ingest is idempotent on
 * (driver_user_id, company_id, captured_at) and that is a backstop, not
 * a design: the drain now also lands in the clock-skew shift's 2 to 30
 * minute band for the first time, and a shifted re-post carries
 * different timestamps, so the key it would be relying on is exactly the
 * key that stops matching. See ./clock-skew.
 *
 * `companyId` may be empty: the iOS drain carries its own from the
 * native side, only the Android geofence drain needs one from here.
 *
 * BOTH BUFFERS HOLD THE SAME FIX STREAM
 *
 * Which made draining them sequentially a double post rather than two
 * halves of a backlog. Production: two ingest POSTs 0.618 s apart, each
 * carrying exactly 1630 points, all 1630 pairs coordinate-identical and
 * offset by exactly 0.6310 s with standard deviation 0.0000. Ingest is
 * idempotent on (driver_user_id, company_id, captured_at) and a 631 ms
 * difference is not a conflict, so both copies stored; merged with the
 * live stream the pool held 1263 of 3351 transitions above 60 m/s, and
 * the drive was correctly refused as implausible and never appeared.
 *
 * So the second drain is told what the first one CONFIRMED, and skips
 * its own copy of those fixes. Anything the first batch did not cover is
 * still uploaded, which is the whole reason this is a per-fix check and
 * not "skip the second buffer when the first one had something".
 */
export async function drainNativeBuffers(
  companyId: string,
  trigger: NativeDrainTrigger,
): Promise<number> {
  if (draining) return 0;
  const now = Date.now();
  // Measured from the ATTEMPT, not from the last attempt that moved
  // points. A device with empty buffers must not pay a bridge round trip
  // on every location callback for the rest of the drive.
  if (lastAttemptMs > 0 && now - lastAttemptMs < NATIVE_DRAIN_EVERY_MS) {
    return 0;
  }
  draining = true;
  lastAttemptMs = now;
  let points = 0;
  // Reported even when the try below throws part way, so a pass that
  // half ran is described by what it actually did rather than by the
  // previous pass's numbers.
  let checked = 0;
  let suppressed = 0;
  try {
    // Sequential, not Promise.all. Two concurrent uploads of up to a
    // batch each is the flood this is supposed to avoid, and there is
    // nothing to be gained by finishing a background drain sooner. The
    // order is now load-bearing for a second reason: the geofence batch
    // has to be CONFIRMED on the server before the other drain can treat
    // it as covering anything.
    let geofencePosted: PostedFix[] = [];
    if (companyId) {
      points += await drainGeofenceBuffer(companyId, (posted) => {
        geofencePosted = posted;
      });
    }
    // geofencePosted stays empty unless the geofence POST was accepted,
    // so a refused or skipped geofence drain covers nothing and the
    // buffer below posts in full, exactly as it did before this change.
    const coverage = coverageOf(companyId, geofencePosted);
    points += await drainNativeLocationBuffer(coverage.check);
    checked = coverage.tally.checked;
    suppressed = coverage.tally.suppressed;
  } catch {
    // Both drains already swallow their own failures and leave the fixes
    // on disk; this is the belt for a bridge that rejects in a new way.
  } finally {
    draining = false;
  }
  nativeDrainDiag.lastTrigger = trigger;
  nativeDrainDiag.lastAtMs = now;
  nativeDrainDiag.lastPoints = points;
  // Overwritten every pass, never accumulated. A stale count from a pass
  // three hours ago, read as current, is how this repo has convinced
  // itself a dead thing was alive before.
  nativeDrainDiag.lastChecked = checked;
  nativeDrainDiag.lastSuppressed = suppressed;
  return points;
}

/** Test seam. Module state is per page life in the app, per file here. */
export function __resetNativeDrainForTest(): void {
  draining = false;
  lastAttemptMs = 0;
  nativeDrainDiag.lastTrigger = null;
  nativeDrainDiag.lastAtMs = 0;
  nativeDrainDiag.lastPoints = 0;
  nativeDrainDiag.lastChecked = 0;
  nativeDrainDiag.lastSuppressed = 0;
}
