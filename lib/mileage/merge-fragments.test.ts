import { describe, expect, it } from "vitest";
import { TRIP_END_DWELL_MS } from "./segmentation";
import {
  FRAGMENT_MAX_GAP_MS,
  FRAGMENT_MAX_JUMP_M,
  planFragmentMerges,
  type FragmentTrip,
} from "./merge-fragments";

/**
 * Stitching back drives that finalize severed on an upload stall.
 *
 * The fragments have a signature nothing else has: the next trip starts
 * SECONDS after the previous one ended, from essentially the same spot,
 * because the two halves are one continuous GPS stream that arrived in two
 * batches. Real consecutive drives cannot look like this. Segmentation
 * only ends a trip on a 10 minute dwell or an 8 minute capture gap, so any
 * pair separated by seconds was one drive by the pipeline's own rules.
 *
 * Both conditions are required, and the spatial one is what keeps this
 * honest. A time-only rule would happily weld together two trips that
 * begin miles apart and invent the mileage in between, which is exactly
 * the fabricated-distance failure this project guards against elsewhere.
 */

const T0 = 1_760_000_000_000;
const SEC = 1000;
const MIN = 60_000;

/** Shakopee-ish, ~0.0009 deg latitude is about 100 m. */
function trip(
  id: string,
  startMs: number,
  endMs: number,
  miles: number,
  lat = 44.762,
  lng = -93.473,
  endLat = lat,
  endLng = lng,
): FragmentTrip {
  return {
    id,
    startedAtMs: startMs,
    endedAtMs: endMs,
    distanceMiles: miles,
    startLat: lat,
    startLng: lng,
    endLat,
    endLng,
  };
}

describe("planFragmentMerges", () => {
  it("stitches the real 2026-08-09 pair, six seconds apart", () => {
    // 15:04:57 -> 15:23:00 (16.566 mi), then 15:23:06 -> 15:24:52 (0.304).
    const a = trip("a", T0, T0 + 18 * MIN, 16.566, 44.9, -93.44, 44.87, -93.42);
    const b = trip(
      "b",
      T0 + 18 * MIN + 6 * SEC,
      T0 + 20 * MIN,
      0.304,
      44.87,
      -93.42,
      44.868,
      -93.419,
    );
    const plans = planFragmentMerges([a, b]);
    expect(plans).toHaveLength(1);
    expect(plans[0].keepId).toBe("a");
    expect(plans[0].absorbIds).toEqual(["b"]);
    expect(plans[0].endedAtMs).toBe(b.endedAtMs);
    // Distance is the two real distances plus the real displacement across
    // the seam. Nothing is invented.
    expect(plans[0].distanceMiles).toBeGreaterThanOrEqual(16.566 + 0.304);
    expect(plans[0].distanceMiles).toBeLessThan(16.566 + 0.304 + 0.3);
  });

  it("leaves genuinely separate drives alone", () => {
    // 13.3 minutes apart: above the dwell, so segmentation would have
    // ended the first trip anyway. That is a real stop, not a seam.
    const a = trip("a", T0, T0 + 10 * MIN, 3.9);
    const b = trip("b", T0 + 10 * MIN + 13.3 * MIN, T0 + 28 * MIN, 2.4);
    expect(planFragmentMerges([a, b])).toEqual([]);
  });

  it("refuses to weld fragments that start somewhere else entirely", () => {
    // Seconds apart in TIME but 30 km apart in SPACE. Merging would
    // fabricate the distance between them, which is worse than leaving
    // two trips.
    const a = trip("a", T0, T0 + 10 * MIN, 5, 44.76, -93.47, 44.76, -93.47);
    const b = trip(
      "b",
      T0 + 10 * MIN + 5 * SEC,
      T0 + 20 * MIN,
      5,
      45.03,
      -93.47,
      45.03,
      -93.47,
    );
    expect(planFragmentMerges([a, b])).toEqual([]);
  });

  it("chains three fragments of one drive into a single trip", () => {
    const a = trip("a", T0, T0 + 10 * MIN, 5, 44.76, -93.47, 44.77, -93.47);
    const b = trip(
      "b",
      T0 + 10 * MIN + 5 * SEC,
      T0 + 20 * MIN,
      5,
      44.77,
      -93.47,
      44.78,
      -93.47,
    );
    const c = trip(
      "c",
      T0 + 20 * MIN + 5 * SEC,
      T0 + 30 * MIN,
      5,
      44.78,
      -93.47,
      44.79,
      -93.47,
    );
    const plans = planFragmentMerges([a, b, c]);
    expect(plans).toHaveLength(1);
    expect(plans[0].keepId).toBe("a");
    expect(plans[0].absorbIds).toEqual(["b", "c"]);
    expect(plans[0].endedAtMs).toBe(c.endedAtMs);
  });

  it("never merges across an overlap, which would double-count", () => {
    const a = trip("a", T0, T0 + 10 * MIN, 5);
    const b = trip("b", T0 + 9 * MIN, T0 + 20 * MIN, 5);
    expect(planFragmentMerges([a, b])).toEqual([]);
  });

  it("is order-independent", () => {
    const a = trip("a", T0, T0 + 10 * MIN, 5, 44.76, -93.47, 44.77, -93.47);
    const b = trip(
      "b",
      T0 + 10 * MIN + 5 * SEC,
      T0 + 20 * MIN,
      5,
      44.77,
      -93.47,
      44.78,
      -93.47,
    );
    expect(planFragmentMerges([b, a])).toEqual(planFragmentMerges([a, b]));
  });

  it("keeps the gap window well under the dwell that defines a real stop", () => {
    // If this ever crept up to TRIP_END_DWELL_MS it would start merging
    // genuine back-to-back drives with a short stop between them.
    expect(FRAGMENT_MAX_GAP_MS).toBeLessThan(TRIP_END_DWELL_MS / 4);
    expect(FRAGMENT_MAX_JUMP_M).toBeLessThan(1000);
  });

  it("returns nothing for a single trip or none", () => {
    expect(planFragmentMerges([])).toEqual([]);
    expect(planFragmentMerges([trip("a", T0, T0 + MIN, 1)])).toEqual([]);
  });
});
