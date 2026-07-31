import { describe, expect, it } from "vitest";
import {
  CLUSTER_MIN_POINTS,
  DWELL_SAME_SPOT_M,
  MAX_LEARNED_PLACES,
  MAX_RADIUS_M,
  MIN_GAP_MS,
  MIN_RADIUS_M,
  MIN_VISIT_DAYS,
  clusterCandidates,
  extractPlaceCandidates,
  learnPlaces,
  placeKey,
  type RawPoint,
} from "./places";

const HOUR = 3600_000;
const MIN = 60_000;

/** Longitude 0 keeps the longitude-derived local-time offset at zero,
 *  so test timestamps in UTC are also local time. */
const HOME = { lat: 51.5, lng: 0.0 };
/** Roughly 8 km east of HOME: far outside any cluster radius. */
const WORK = { lat: 51.5, lng: 0.115 };

/** Metres to degrees latitude, near enough for test fixtures. */
function offsetLat(base: { lat: number; lng: number }, metres: number) {
  return { lat: base.lat + metres / 111_320, lng: base.lng };
}

function point(at: { lat: number; lng: number }, ts: number): RawPoint {
  return { lat: at.lat, lng: at.lng, ts };
}

/** One day of a commuter: parked at home overnight, drive, parked at
 *  work through the day, drive home. Timestamps are UTC = local. */
function commuteDay(dayIndex: number): RawPoint[] {
  const day = Date.UTC(2026, 5, 1 + dayIndex);
  return [
    // Last fix before the overnight stop, at home, 22:00.
    point(HOME, day + 22 * HOUR),
    // First fix next morning at home, 08:00. Same spot, so this is a
    // confirmed dwell and both ends count.
    point(offsetLat(HOME, 15), day + 24 * HOUR + 8 * HOUR),
    // Mid-drive.
    point({ lat: 51.5, lng: 0.05 }, day + 24 * HOUR + 8 * HOUR + 15 * MIN),
    // Arrive at work, 08:40.
    point(WORK, day + 24 * HOUR + 8 * HOUR + 40 * MIN),
    // Leave work 17:00 from the same spot: confirmed daytime dwell.
    point(offsetLat(WORK, 20), day + 24 * HOUR + 17 * HOUR),
  ];
}

describe("extractPlaceCandidates", () => {
  it("ignores gaps shorter than a real stop", () => {
    const base = Date.UTC(2026, 5, 1);
    const candidates = extractPlaceCandidates([
      point(HOME, base),
      point(HOME, base + MIN_GAP_MS - 1),
    ]);
    // Only the trailing open-ended stop, no gap-derived pair.
    expect(candidates).toHaveLength(1);
    expect(candidates[0].confirmedDwell).toBe(false);
  });

  it("treats a same-spot gap as a confirmed dwell and keeps both ends", () => {
    const base = Date.UTC(2026, 5, 1);
    const candidates = extractPlaceCandidates([
      point(HOME, base),
      point(offsetLat(HOME, 20), base + 8 * HOUR),
    ]);
    const confirmed = candidates.filter((c) => c.confirmedDwell);
    expect(confirmed).toHaveLength(2);
    expect(confirmed[0].dwellMs).toBe(8 * HOUR);
  });

  it("keeps only the pre-gap end when a drive happened inside the gap", () => {
    // This is the blackout case the whole feature exists for: the phone
    // died at home and came back mid-commute. The point BEFORE the gap
    // is exactly where we want a geofence; the point after is not a
    // place at all.
    const base = Date.UTC(2026, 5, 1);
    const candidates = extractPlaceCandidates([
      point(HOME, base),
      point(WORK, base + 10 * HOUR),
    ]);
    const fromGap = candidates.filter((c) => c.dwellMs === 10 * HOUR);
    expect(fromGap).toHaveLength(1);
    expect(fromGap[0].lat).toBeCloseTo(HOME.lat, 6);
    expect(fromGap[0].confirmedDwell).toBe(false);
  });

  it("uses the same-spot threshold as the dwell boundary", () => {
    const base = Date.UTC(2026, 5, 1);
    const justInside = extractPlaceCandidates([
      point(HOME, base),
      point(offsetLat(HOME, DWELL_SAME_SPOT_M - 20), base + 8 * HOUR),
    ]);
    const justOutside = extractPlaceCandidates([
      point(HOME, base),
      point(offsetLat(HOME, DWELL_SAME_SPOT_M + 40), base + 8 * HOUR),
    ]);
    expect(justInside.filter((c) => c.confirmedDwell)).toHaveLength(2);
    expect(justOutside.filter((c) => c.confirmedDwell)).toHaveLength(0);
  });

  it("sorts unordered input rather than trusting the caller", () => {
    const base = Date.UTC(2026, 5, 1);
    const candidates = extractPlaceCandidates([
      point(offsetLat(HOME, 10), base + 8 * HOUR),
      point(HOME, base),
    ]);
    expect(candidates.filter((c) => c.confirmedDwell)).toHaveLength(2);
  });

  it("drops structurally invalid points instead of clustering garbage", () => {
    const base = Date.UTC(2026, 5, 1);
    const candidates = extractPlaceCandidates([
      { lat: Number.NaN, lng: 0, ts: base },
      { lat: 91, lng: 0, ts: base + HOUR },
      point(HOME, base + 2 * HOUR),
      point(offsetLat(HOME, 10), base + 12 * HOUR),
    ]);
    expect(candidates.every((c) => Number.isFinite(c.lat))).toBe(true);
    expect(candidates.filter((c) => c.confirmedDwell)).toHaveLength(2);
  });

  it("returns nothing for an empty stream", () => {
    expect(extractPlaceCandidates([])).toEqual([]);
  });
});

describe("clusterCandidates", () => {
  it("discards a one-off stop as noise instead of dragging a centroid", () => {
    // Three days at home plus a single visit to a restaurant. The
    // restaurant must not become a cluster and must not move home.
    const points: RawPoint[] = [];
    for (let d = 0; d < 4; d++) {
      const day = Date.UTC(2026, 5, 1 + d);
      points.push(point(HOME, day + 22 * HOUR));
      points.push(point(offsetLat(HOME, 10), day + 24 * HOUR + 8 * HOUR));
    }
    const restaurant = { lat: 51.6, lng: 0.3 };
    points.push(point(restaurant, Date.UTC(2026, 5, 3) + 19 * HOUR));
    points.push(point(restaurant, Date.UTC(2026, 5, 3) + 21 * HOUR));

    // DBSCAN alone WILL form a cluster here: one evening out produces
    // arrival, departure and the departure that bounds the drive home,
    // which is three candidates and meets the core threshold. The
    // distinct-day rule is what rejects it, so assert on learnPlaces.
    expect(CLUSTER_MIN_POINTS).toBe(3);
    const clusters = clusterCandidates(extractPlaceCandidates(points));
    expect(clusters.length).toBeGreaterThanOrEqual(1);

    const places = learnPlaces(points);
    expect(places).toHaveLength(1);
    expect(places[0].lat).toBeCloseTo(HOME.lat, 3);
  });

  it("rejects a place seen on fewer than MIN_VISIT_DAYS separate days", () => {
    const day = Date.UTC(2026, 5, 1);
    // Three stops, all on one day, at one spot. Enough candidates for
    // DBSCAN, not enough days to be habitual.
    const points = [
      point(HOME, day + 9 * HOUR),
      point(offsetLat(HOME, 5), day + 11 * HOUR),
      point(offsetLat(HOME, 8), day + 13 * HOUR),
      point(offsetLat(HOME, 5), day + 15 * HOUR),
    ];
    expect(MIN_VISIT_DAYS).toBe(3);
    expect(learnPlaces(points)).toEqual([]);
  });

  it("keeps the radius inside the configured bounds", () => {
    const points: RawPoint[] = [];
    for (let d = 0; d < 6; d++) {
      const day = Date.UTC(2026, 5, 1 + d);
      // Spread the fixes across a wide car park.
      points.push(point(offsetLat(HOME, d * 12), day + 22 * HOUR));
      points.push(point(offsetLat(HOME, d * 12 + 6), day + 24 * HOUR + 8 * HOUR));
    }
    const clusters = clusterCandidates(extractPlaceCandidates(points));
    expect(clusters.length).toBeGreaterThan(0);
    for (const c of clusters) {
      expect(c.radiusM).toBeGreaterThanOrEqual(MIN_RADIUS_M);
      expect(c.radiusM).toBeLessThanOrEqual(MAX_RADIUS_M);
    }
  });
});

describe("learnPlaces", () => {
  const commuter = Array.from({ length: 10 }, (_, d) => commuteDay(d)).flat();

  it("labels the overnight cluster home and ranks it first", () => {
    const places = learnPlaces(commuter);
    expect(places.length).toBeGreaterThanOrEqual(2);
    expect(places[0].label).toBe("home");
    expect(places[0].rank).toBe(0);
    expect(places[0].lat).toBeCloseTo(HOME.lat, 3);
  });

  it("labels the weekday-daytime cluster work", () => {
    const places = learnPlaces(commuter);
    const work = places.find((p) => p.label === "work");
    expect(work).toBeDefined();
    expect(work?.lng).toBeCloseTo(WORK.lng, 2);
  });

  it("never returns more than the platform-safe place cap", () => {
    // Twelve distinct habitual places, each visited enough to cluster.
    const points: RawPoint[] = [];
    for (let place = 0; place < 12; place++) {
      const at = { lat: 51.5 + place * 0.05, lng: 0 };
      for (let d = 0; d < 4; d++) {
        const day = Date.UTC(2026, 5, 1 + d);
        points.push(point(at, day + 20 * HOUR));
        points.push(point(offsetLat(at, 10), day + 24 * HOUR + 6 * HOUR));
      }
    }
    const places = learnPlaces(points);
    expect(places.length).toBeLessThanOrEqual(MAX_LEARNED_PLACES);
    expect(MAX_LEARNED_PLACES).toBe(8);
  });

  it("returns nothing rather than guessing when there is no history", () => {
    expect(learnPlaces([])).toEqual([]);
    expect(learnPlaces([point(HOME, Date.UTC(2026, 5, 1))])).toEqual([]);
  });

  it("gives every place a radius a geofence can actually use", () => {
    for (const place of learnPlaces(commuter)) {
      expect(place.radiusM).toBeGreaterThanOrEqual(MIN_RADIUS_M);
      expect(place.radiusM).toBeLessThanOrEqual(MAX_RADIUS_M);
    }
  });

  it("caps one enormous stop so a holiday cannot outrank home", () => {
    // A month-long airport car park, visited twice, against a home
    // visited nightly for ten days.
    const airport = { lat: 51.9, lng: 0.0 };
    const points = [...commuter];
    for (let d = 0; d < 3; d++) {
      const day = Date.UTC(2026, 6, 1 + d * 30);
      points.push(point(airport, day));
      points.push(point(offsetLat(airport, 10), day + 29 * 24 * HOUR));
    }
    const places = learnPlaces(points);
    expect(places[0].label).toBe("home");
    expect(places[0].lat).toBeCloseTo(HOME.lat, 3);
  });

  it("keeps place keys stable across small centroid drift", () => {
    // Three decimal places is about 110 m: a few metres of drift
    // between recomputes must not churn the device's geofence ids.
    expect(placeKey(51.500_01, -0.120_02)).toBe(placeKey(51.500_04, -0.120_01));
  });
});
