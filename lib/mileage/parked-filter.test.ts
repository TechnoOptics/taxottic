import { describe, expect, it } from "vitest";
import {
  PARKED_KEEPALIVE_MS,
  PARKED_RADIUS_M,
  shouldKeepFix,
} from "./parked-filter";
import { MAX_CAPTURE_GAP_MS, TRIP_END_DWELL_MS } from "./segmentation";
import { HEARTBEAT_EVERY_MS } from "./heartbeat-timer";

/**
 * Stop uploading a parked phone's GPS scatter, without going silent.
 *
 * MEASURED 2026-08-10, the owner's Fold, 2.6 hours parked at home:
 *
 *   points emitted        140
 *   average gap           68.3 s   (max 73.1, low variance)
 *   average movement      0.8 m
 *   MAXIMUM movement      7.7 m
 *
 * The phone never moved more than 7.7 metres and emitted a point every
 * ~70 seconds anyway. distanceFilter is set to 25 m and suppresses
 * nothing: the plugin emits on a time basis regardless. That is about
 * 1,200 rows a day per driver carrying no information.
 *
 * TWO THINGS THIS MUST NOT BREAK, and they pull in opposite directions.
 *
 * 1. Drive detection. Suppressing sub-filter fixes cannot delay it,
 *    because a drive moves further than the filter by definition. The
 *    first genuinely moving fix is kept and capture proceeds untouched.
 *    Every test below that moves beyond PARKED_RADIUS_M asserts this.
 *
 * 2. Liveness. The heartbeat rides ingest, and finalize's tail-close
 *    needs a heartbeat NEWER than the last point to tell an idle phone
 *    from a silent one (see tail-close.ts). Suppressing to zero would
 *    re-break the visibility restored in #545/#547 and hang trips open
 *    again. Hence the keepalive floor: a parked phone still reports, at
 *    a tenth of the volume.
 */

const T0 = 1_760_000_000_000;
const HOME = { lat: 44.7619, lng: -93.4731 };

/** Metres to degrees of latitude, near enough at this latitude. */
function north(from: { lat: number; lng: number }, meters: number) {
  return { lat: from.lat + meters / 111_320, lng: from.lng };
}

describe("shouldKeepFix", () => {
  it("always keeps the first fix, with nothing to compare against", () => {
    expect(
      shouldKeepFix({ fix: { ...HOME, ts: T0 }, lastKept: null }),
    ).toBe(true);
  });

  it("drops the measured scatter of a parked phone", () => {
    // 7.7 m was the worst real movement across 2.6 hours parked.
    const scatter = { ...north(HOME, 7.7), ts: T0 + 70_000 };
    expect(
      shouldKeepFix({ fix: scatter, lastKept: { ...HOME, ts: T0 } }),
    ).toBe(false);
  });

  it("keeps a fix that actually moved, so a drive starts immediately", () => {
    // THE SAFETY PROPERTY. Anything past the radius is kept at once, no
    // waiting, no keepalive needed.
    const moved = { ...north(HOME, PARKED_RADIUS_M + 5), ts: T0 + 5_000 };
    expect(shouldKeepFix({ fix: moved, lastKept: { ...HOME, ts: T0 } })).toBe(
      true,
    );
  });

  it("keeps a parked fix once the keepalive has elapsed", () => {
    // Liveness floor: the device must keep proving it is alive, or the
    // heartbeat stops and tail-close cannot distinguish idle from dead.
    const still = { ...north(HOME, 2), ts: T0 + PARKED_KEEPALIVE_MS };
    expect(shouldKeepFix({ fix: still, lastKept: { ...HOME, ts: T0 } })).toBe(
      true,
    );
  });

  it("does not keep it a moment before the keepalive", () => {
    const still = { ...north(HOME, 2), ts: T0 + PARKED_KEEPALIVE_MS - 1_000 };
    expect(shouldKeepFix({ fix: still, lastKept: { ...HOME, ts: T0 } })).toBe(
      false,
    );
  });

  it("cuts the measured parked volume by about three quarters", () => {
    // Replay the real cadence: a fix every 70 s for an hour, all inside
    // the scatter radius.
    let lastKept: { lat: number; lng: number; ts: number } | null = null;
    let kept = 0;
    let emitted = 0;
    for (let t = 0; t < 3_600_000; t += 70_000) {
      emitted++;
      const fix = { ...north(HOME, (t % 3) * 2), ts: T0 + t };
      if (shouldKeepFix({ fix, lastKept })) {
        kept++;
        lastKept = fix;
      }
    }
    expect(emitted).toBeGreaterThan(45);
    // One per keepalive window, not one per 70 seconds. At a 5 minute
    // keepalive that is ~12 an hour against ~51 emitted, a 76% cut.
    // It was 88% at a 10 minute keepalive, which severed drives across
    // any stop longer than MAX_CAPTURE_GAP_MS. The extra six rows an
    // hour are what a whole drive leg costs.
    expect(kept).toBeLessThanOrEqual(13);
    expect(kept).toBeGreaterThanOrEqual(11);
  });

  it("NEVER exceeds the capture gap that severs a trip", () => {
    // THE BUG THIS FILE SHIPPED WITH, and the assertion that would have
    // caught it before a driver lost a leg of a drive.
    //
    // Segmentation severs a trip when consecutive points are more than
    // MAX_CAPTURE_GAP_MS apart. Suppressing every fix during a stop
    // MANUFACTURES such a gap, so a keepalive at or above that bound
    // turns an ordinary stop into two trips and drops the connector.
    // The original 10 minute value sat 2 minutes ABOVE it.
    expect(PARKED_KEEPALIVE_MS).toBeLessThan(MAX_CAPTURE_GAP_MS);
  });

  it("keeps a fix during a 9 minute stop, so a drive is not severed", () => {
    // The concrete case: fuel stop, car stationary, every fix inside the
    // scatter radius. Before the fix the next kept point was ~9 minutes
    // later and segmentation split the drive there.
    const stopStart = T0;
    let lastKept: { lat: number; lng: number; ts: number } = { ...HOME, ts: stopStart };
    let longestSilence = 0;
    // Fixes arrive every 30s for 9 minutes, none of them moving.
    for (let t = 30_000; t <= 9 * 60_000; t += 30_000) {
      const fix = { ...north(HOME, 3), ts: stopStart + t };
      if (shouldKeepFix({ fix, lastKept })) {
        longestSilence = Math.max(longestSilence, fix.ts - lastKept.ts);
        lastKept = fix;
      }
    }
    longestSilence = Math.max(longestSilence, stopStart + 9 * 60_000 - lastKept.ts);
    expect(
      longestSilence,
      "a gap this long is what segmentation reads as a severed drive",
    ).toBeLessThan(MAX_CAPTURE_GAP_MS);
  });

  it("still reports at least as often as the heartbeat interval", () => {
    // The beat is armed from the same kept-fix path, so a keepalive
    // longer than HEARTBEAT_EVERY_MS silently halves heartbeat cadence.
    expect(PARKED_KEEPALIVE_MS).toBeLessThanOrEqual(HEARTBEAT_EVERY_MS);
  });

  it("never lets a parked phone go quiet for longer than the tail-close dwell", () => {
    // If the keepalive exceeded TRIP_END_DWELL_MS, a parked phone would
    // look silent to finalize and trips would hang open, which is the
    // exact failure #549 fixed from the other side.
    expect(PARKED_KEEPALIVE_MS).toBeLessThanOrEqual(TRIP_END_DWELL_MS);
  });

  it("sets the radius above real scatter and at or above the distance filter", () => {
    // Measured worst scatter was 7.7 m; the watcher's distanceFilter is
    // 25 m. The radius must clear both so scatter never reads as travel.
    expect(PARKED_RADIUS_M).toBeGreaterThanOrEqual(25);
    expect(PARKED_RADIUS_M).toBeLessThan(100);
  });

  it("treats an out-of-order fix as keepable rather than guessing", () => {
    const earlier = { ...HOME, ts: T0 - 60_000 };
    expect(shouldKeepFix({ fix: earlier, lastKept: { ...HOME, ts: T0 } })).toBe(
      true,
    );
  });
});
