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
  type TripSpan,
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

describe("learnPlaces with trip endpoints", () => {
  const T0 = 1_760_000_000_000;
  const DAY = 86_400_000;
  const MIN = 60_000;
  const HOME = { lat: 44.7619, lng: -93.4731 };
  const SITE = { lat: 44.868, lng: -93.415 };

  /** Three days of commuting, expressed only as trips. */
  function commuteTrips(days: number): TripSpan[] {
    const out: TripSpan[] = [];
    for (let d = 0; d < days; d++) {
      const dayStart = T0 + d * DAY;
      // Leave home 09:00, arrive site 09:30.
      out.push({
        startLat: HOME.lat,
        startLng: HOME.lng,
        startMs: dayStart + 9 * 60 * MIN,
        endLat: SITE.lat,
        endLng: SITE.lng,
        endMs: dayStart + 9.5 * 60 * MIN,
      });
      // Leave site 17:00, home 17:30.
      out.push({
        startLat: SITE.lat,
        startLng: SITE.lng,
        startMs: dayStart + 17 * 60 * MIN,
        endLat: HOME.lat,
        endLng: HOME.lng,
        endMs: dayStart + 17.5 * 60 * MIN,
      });
    }
    return out;
  }

  it("pins the visit-day boundary on the same fixture: two days learns nothing, three days learns something", () => {
    // Same fixture at two different day counts, so the pair is honest
    // about what breaks the boundary. Two days must not clear
    // MIN_VISIT_DAYS (3), but three days, differing only in the day
    // count, must. A version of learnPlaces that ignores its trips
    // argument entirely would return [] for BOTH calls, so this fails
    // without the merge rather than passing vacuously.
    expect(learnPlaces([], commuteTrips(2))).toEqual([]);
    expect(learnPlaces([], commuteTrips(3)).length).toBeGreaterThan(0);
  });

  it("learns home and the work site from trips with no raw points at all", () => {
    // THE POINT OF THE CHANGE. The old engine returns [] here, because
    // there are no raw points to derive a dwell from.
    expect(learnPlaces([], [])).toEqual([]);

    const places = learnPlaces([], commuteTrips(5));
    expect(places.length).toBeGreaterThanOrEqual(2);
    const labels = places.map((p) => p.label);
    expect(labels).toContain("home");
    // Home is the overnight place, so it must outrank the work site.
    expect(places[0].label).toBe("home");
    const home = places.find((p) => p.label === "home")!;
    expect(Math.abs(home.lat - HOME.lat)).toBeLessThan(0.005);
  });

  it("respects the cap when trips add many habitual places", () => {
    const trips = commuteTrips(5);
    let ms = T0 + 40 * DAY;
    // Ten extra habitual places, each visited on 4 separate days.
    for (let place = 0; place < 10; place++) {
      for (let d = 0; d < 4; d++) {
        const lat = 45.2 + place * 0.05;
        trips.push({
          startLat: HOME.lat,
          startLng: HOME.lng,
          startMs: ms,
          endLat: lat,
          endLng: -93.4,
          endMs: ms + 30 * MIN,
        });
        trips.push({
          startLat: lat,
          startLng: -93.4,
          startMs: ms + 200 * MIN,
          endLat: HOME.lat,
          endLng: HOME.lng,
          endMs: ms + 230 * MIN,
        });
        ms += DAY;
      }
    }
    const places = learnPlaces([], trips);
    expect(places.length).toBeLessThanOrEqual(MAX_LEARNED_PLACES);
    expect(places[0].label).toBe("home");
  });

  it("merges points and trip endpoints attesting the same stop into one cluster, counting visits by distinct day", () => {
    const days = 3;
    const points: RawPoint[] = [];
    const trips: TripSpan[] = [];
    for (let d = 0; d < days; d++) {
      const dayStart = T0 + d * DAY;
      // Raw fixes: a mid-morning and an early-evening fix, both at
      // home, same local calendar day. Confirmed same-spot dwell.
      points.push({ lat: HOME.lat, lng: HOME.lng, ts: dayStart + 9 * 60 * MIN });
      points.push({ lat: HOME.lat, lng: HOME.lng, ts: dayStart + 20 * 60 * MIN });
      // Trips: arrive home from an errand, then leave again later the
      // same day. The gap between them attests the SAME address, a
      // second and independent way, on the SAME calendar day.
      trips.push({
        startLat: SITE.lat,
        startLng: SITE.lng,
        startMs: dayStart + 7 * 60 * MIN,
        endLat: HOME.lat,
        endLng: HOME.lng,
        endMs: dayStart + 8 * 60 * MIN,
      });
      trips.push({
        startLat: HOME.lat,
        startLng: HOME.lng,
        startMs: dayStart + 12 * 60 * MIN,
        endLat: SITE.lat,
        endLng: SITE.lng,
        endMs: dayStart + 12.5 * 60 * MIN,
      });
    }

    // Both sources independently clear the visit-day bar on their own,
    // so this is genuinely double attestation of one place, not one
    // source propping up the other.
    expect(learnPlaces(points, []).some((p) => p.label === "home")).toBe(true);
    expect(learnPlaces([], trips).some((p) => p.label === "home")).toBe(true);

    const merged = learnPlaces(points, trips);

    // (a) One cluster for the place, not two competing ones.
    const homes = merged.filter(
      (p) =>
        Math.abs(p.lat - HOME.lat) < 0.01 && Math.abs(p.lng - HOME.lng) < 0.01,
    );
    expect(homes).toHaveLength(1);

    // (b) visits counts DISTINCT DAYS (a Set of local day index), so it
    // stays immune to the same place being attested twice a day by two
    // independent sources, rather than counting candidates.
    //
    // dwellHours, by contrast, is a plain sum of both sources' credit
    // with no dedup, so a doubly-attested stop can carry roughly double
    // the dwell weight of a singly-attested one. That is intentional
    // (a place attested by both sources gets the combined weight, per
    // the comment on learnPlaces) and is not asserted here.
    expect(homes[0].visits).toBe(days);
  });
});
