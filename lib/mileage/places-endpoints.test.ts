import { describe, expect, it } from "vitest";
import {
  DWELL_SAME_SPOT_M,
  MIN_GAP_MS,
  extractEndpointCandidates,
  type TripSpan,
} from "./places";

/**
 * Trip endpoints as dwell evidence.
 *
 * A trip that ends at a place and is followed by a trip starting at the
 * same place describes a stop, exactly as the gap between two consecutive
 * raw points does. So this mirrors extractPlaceCandidates rather than
 * inventing a second set of rules.
 *
 * It exists because the raw-point path starves: mileage-retention deletes
 * consumed rows at 30 days against a 90 day clustering window, and raw
 * points are precisely what a broken tracker fails to produce. Trips are
 * permanent. Measured on the owner's 90 days: raw dwells yielded ONE
 * place, trip endpoints yield three, covering 20 additional drive starts
 * that had no geofence under them.
 */

const T0 = 1_760_000_000_000;
const MIN = 60_000;
const HOME = { lat: 44.7619, lng: -93.4731 };
const SITE = { lat: 44.868, lng: -93.415 };

function span(
  startMs: number,
  endMs: number,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): TripSpan {
  return {
    startLat: from.lat,
    startLng: from.lng,
    startMs,
    endLat: to.lat,
    endLng: to.lng,
    endMs,
  };
}

describe("extractEndpointCandidates", () => {
  it("returns nothing for no trips", () => {
    expect(extractEndpointCandidates([])).toEqual([]);
  });

  it("credits a parked gap between two trips at the same place", () => {
    // Arrive at SITE at T0+30min, leave SITE at T0+120min: 90 minutes parked.
    const trips = [
      span(T0, T0 + 30 * MIN, HOME, SITE),
      span(T0 + 120 * MIN, T0 + 150 * MIN, SITE, HOME),
    ];
    const out = extractEndpointCandidates(trips);
    const atSite = out.filter(
      (c) => Math.abs(c.lat - SITE.lat) < 0.001 && c.confirmedDwell,
    );
    expect(atSite.length).toBe(2);
    expect(atSite[0].dwellMs).toBe(90 * MIN);
    expect(atSite[0].startMs).toBe(T0 + 30 * MIN);
    expect(atSite[0].endMs).toBe(T0 + 120 * MIN);
  });

  it("does not confirm a dwell when the next trip starts somewhere else", () => {
    // Ended at SITE, next trip starts at HOME: the vehicle moved without
    // being captured, so this is a blackout and not a stop.
    const trips = [
      span(T0, T0 + 30 * MIN, HOME, SITE),
      span(T0 + 120 * MIN, T0 + 150 * MIN, HOME, SITE),
    ];
    const out = extractEndpointCandidates(trips);
    expect(out.some((c) => c.confirmedDwell && c.lat === SITE.lat)).toBe(false);
  });

  it("ignores a turnaround shorter than the minimum gap", () => {
    const trips = [
      span(T0, T0 + 30 * MIN, HOME, SITE),
      span(T0 + 30 * MIN + 5000, T0 + 60 * MIN, SITE, HOME),
    ];
    const out = extractEndpointCandidates(trips);
    expect(out.every((c) => c.dwellMs >= MIN_GAP_MS)).toBe(true);
  });

  it("credits the final trip's end as an open stop, at minimum weight", () => {
    const trips = [span(T0, T0 + 30 * MIN, HOME, SITE)];
    const out = extractEndpointCandidates(trips);
    const tail = out.find((c) => c.ts === T0 + 30 * MIN);
    expect(tail).toBeDefined();
    expect(tail!.dwellMs).toBe(MIN_GAP_MS);
    expect(tail!.confirmedDwell).toBe(false);
  });

  it("treats a small GPS scatter at the same address as one spot", () => {
    // ~40 m apart, comfortably inside DWELL_SAME_SPOT_M.
    const nudged = { lat: SITE.lat + 0.00036, lng: SITE.lng };
    const trips = [
      span(T0, T0 + 30 * MIN, HOME, SITE),
      span(T0 + 120 * MIN, T0 + 150 * MIN, nudged, HOME),
    ];
    expect(DWELL_SAME_SPOT_M).toBeGreaterThan(40);
    const out = extractEndpointCandidates(trips);
    expect(out.some((c) => c.confirmedDwell)).toBe(true);
  });

  it("sorts unordered input before pairing", () => {
    const a = span(T0, T0 + 30 * MIN, HOME, SITE);
    const b = span(T0 + 120 * MIN, T0 + 150 * MIN, SITE, HOME);
    expect(extractEndpointCandidates([b, a])).toEqual(
      extractEndpointCandidates([a, b]),
    );
  });

  it("drops trips with non-finite coordinates instead of poisoning a cluster", () => {
    const bad = span(T0, T0 + 30 * MIN, HOME, { lat: NaN, lng: -93.4 });
    const good = span(T0 + 120 * MIN, T0 + 150 * MIN, SITE, HOME);
    const out = extractEndpointCandidates([bad, good]);
    expect(out.every((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))).toBe(
      true,
    );
  });
});
