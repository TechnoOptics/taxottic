import { describe, it, expect } from "vitest";
import {
  segmentTrips,
  haversineMeters,
  suggestClassification,
  type GpsPoint,
  type Place,
  DRIVING_SPEED_MPS,
} from "./segmentation";

// Build points along a meridian from a base lat. 1° lat ≈ 111,320 m,
// so metresNorth → lat delta is metres / 111320. lng fixed → pure
// N/S track, exact distances, easy to reason about.
const BASE_LAT = 37.0;
const BASE_LNG = -122.0;
const M_PER_DEG_LAT = 111_320;
function pt(metersNorth: number, ts: number, extra?: Partial<GpsPoint>): GpsPoint {
  return {
    lat: BASE_LAT + metersNorth / M_PER_DEG_LAT,
    lng: BASE_LNG,
    ts,
    ...extra,
  };
}
const SEC = 1000;
const MIN = 60 * SEC;

describe("haversineMeters", () => {
  it("matches the synthetic metres-north spacing within 0.5%", () => {
    const d = haversineMeters(pt(0, 0), pt(1000, 0));
    expect(d).toBeGreaterThan(995);
    expect(d).toBeLessThan(1005);
  });
});

describe("segmentTrips — the business's logical flow", () => {
  it("one drive then a 5-min stop → exactly one trip ending at arrival", () => {
    const points: GpsPoint[] = [];
    let t = 0;
    // Drive ~3 km: 30 hops of 100 m every 10 s = 10 m/s (> driving
    // threshold of 8 m/s).
    for (let i = 0; i <= 30; i++) {
      points.push(pt(i * 100, t));
      t += 10 * SEC;
    }
    const arrivalNorth = 30 * 100;
    // Sit at the destination for 6 minutes (fixes every 30 s).
    for (let i = 0; i < 13; i++) {
      points.push(pt(arrivalNorth + (i % 2), t)); // ±1 m jitter
      t += 30 * SEC;
    }
    const trips = segmentTrips(points);
    expect(trips).toHaveLength(1);
    expect(trips[0].distanceMiles).toBeGreaterThan(1.7); // ~3 km ≈ 1.86 mi
    expect(trips[0].distanceMiles).toBeLessThan(2.0);
    // One continuous trip whose endpoint is at the arrival location. (A
    // 6-min sit is under TRIP_END_DWELL_MS, so it reads as a stop along
    // the way; the trip still closes here via the end-of-stream tail.)
    expect(trips[0].endPoint.lat).toBeCloseTo(
      BASE_LAT + arrivalNorth / M_PER_DEG_LAT,
      4,
    );
  });

  it("two drives split by a 12-min destination stop → two separate trips", () => {
    const points: GpsPoint[] = [];
    let t = 0;
    let north = 0;
    // Drive A: 20 × 100 m @ 10 s.
    for (let i = 0; i < 20; i++) {
      points.push(pt(north, t));
      north += 100;
      t += 10 * SEC;
    }
    // Park 12.5 min — a real destination, longer than TRIP_END_DWELL_MS.
    for (let i = 0; i < 25; i++) {
      points.push(pt(north, t));
      t += 30 * SEC;
    }
    // Drive B: another 20 × 100 m.
    for (let i = 0; i < 20; i++) {
      points.push(pt(north, t));
      north += 100;
      t += 10 * SEC;
    }
    // Final park 12.5 min so trip B closes too.
    for (let i = 0; i < 25; i++) {
      points.push(pt(north, t));
      t += 30 * SEC;
    }
    const trips = segmentTrips(points);
    expect(trips).toHaveLength(2);
  });

  it("a multi-minute traffic stop does NOT split one drive (the reported bug)", () => {
    // Drive, hit traffic and sit ~6.5 min (longer than the OLD 5-min
    // split, but under TRIP_END_DWELL_MS), then continue. Must come out
    // as ONE continuous trip — not two fragments.
    const points: GpsPoint[] = [];
    let t = 0;
    let north = 0;
    // Drive ~2 km.
    for (let i = 0; i < 20; i++) {
      points.push(pt(north, t));
      north += 100;
      t += 10 * SEC;
    }
    // Stuck in traffic ~6.5 min (13 fixes @ 30 s, ±1 m jitter).
    for (let i = 0; i < 13; i++) {
      points.push(pt(north + (i % 2), t));
      t += 30 * SEC;
    }
    // Continue ~2 km.
    for (let i = 0; i < 20; i++) {
      points.push(pt(north, t));
      north += 100;
      t += 10 * SEC;
    }
    // Final real park (12.5 min) so the (single) trip closes.
    for (let i = 0; i < 25; i++) {
      points.push(pt(north, t));
      t += 30 * SEC;
    }
    const trips = segmentTrips(points);
    expect(trips).toHaveLength(1);
    expect(trips[0].distanceMiles).toBeGreaterThan(2.3); // ~4 km ≈ 2.49 mi
  });

  it("walking only (≈1.3 m/s) → no trips", () => {
    const points: GpsPoint[] = [];
    let t = 0;
    for (let i = 0; i < 60; i++) {
      points.push(pt(i * 13, t)); // 13 m / 10 s = 1.3 m/s
      t += 10 * SEC;
    }
    expect(segmentTrips(points)).toHaveLength(0);
  });

  it("a < 200 m hop is noise, not a trip", () => {
    const points: GpsPoint[] = [];
    let t = 0;
    // 150 m total at driving speed, then a long stop.
    points.push(pt(0, t));
    points.push(pt(150, (t += 10 * SEC)));
    for (let i = 0; i < 13; i++) points.push(pt(150, (t += 30 * SEC)));
    expect(segmentTrips(points)).toHaveLength(0);
  });

  it("a long capture gap closes the open trip", () => {
    const points: GpsPoint[] = [];
    let t = 0;
    for (let i = 0; i < 15; i++) points.push(pt(i * 100, (t += 10 * SEC)));
    // 20-min gap (> MAX_CAPTURE_GAP_MS), then unrelated slow points.
    t += 20 * MIN;
    for (let i = 0; i < 3; i++) points.push(pt(9999 + i, (t += 10 * SEC)));
    const trips = segmentTrips(points);
    expect(trips).toHaveLength(1);
    expect(trips[0].endPoint.lat).toBeCloseTo(
      BASE_LAT + 1400 / M_PER_DEG_LAT,
      4,
    );
  });

  it("respects device-reported speed below threshold even if hops look fast", () => {
    // Big spatial hops but speedMps reported as 2 m/s → not driving.
    const points: GpsPoint[] = [];
    let t = 0;
    for (let i = 0; i < 20; i++) {
      points.push(pt(i * 500, (t += 10 * SEC), { speedMps: 2 }));
    }
    expect(segmentTrips(points)).toHaveLength(0);
  });

  it("IGNORES device speed=0 when haversine reveals real movement (Android plugin bug)", () => {
    // Production forensic 2026-05-26: Android @capgo plugin reports
    // speed_mps=0 on every fix even during real driving. The previous
    // `cur.speedMps >= 0` check returned 0 immediately and the
    // haversine fallback was bypassed → trip never opened. This test
    // proves the fix: a stream of points moving 100 m every 10 s
    // (10 m/s — clearly driving) but each tagged `speedMps: 0` MUST
    // still be detected as a drive.
    const points: GpsPoint[] = [];
    let t = 0;
    for (let i = 0; i <= 30; i++) {
      points.push(pt(i * 100, t, { speedMps: 0 }));
      t += 10 * SEC;
    }
    const arrivalNorth = 30 * 100;
    // Park 6 minutes so the trip closes.
    for (let i = 0; i < 13; i++) {
      points.push(pt(arrivalNorth + (i % 2), t, { speedMps: 0 }));
      t += 30 * SEC;
    }
    const trips = segmentTrips(points);
    expect(trips).toHaveLength(1);
    expect(trips[0].distanceMiles).toBeGreaterThan(1.7); // ~3 km ≈ 1.86 mi
  });

  it("DRIVING_SPEED_MPS is vehicular (above sustained human run)", () => {
    expect(DRIVING_SPEED_MPS).toBeGreaterThan(6); // > elite marathon pace
    expect(DRIVING_SPEED_MPS).toBeLessThan(15); // still catches slow city driving
  });

  it("closeOpenAtEnd:false leaves the tail trip in staging (no fragmentation during a live drive)", () => {
    // 30 hops at 10 m/s — a single ongoing drive that never paused.
    // The default behavior would emit one tail-closed trip; with
    // closeOpenAtEnd:false the trip is deferred so a heartbeat ingest
    // during the drive doesn't materialize a fragment that subsequent
    // points then have to extend (and that the device thinks is
    // already consumed).
    const points: GpsPoint[] = [];
    let t = 0;
    for (let i = 0; i <= 30; i++) {
      points.push(pt(i * 100, t));
      t += 10 * SEC;
    }
    expect(segmentTrips(points, { closeOpenAtEnd: false })).toHaveLength(0);
    // Same input WITH the tail close emits the trip as before.
    expect(segmentTrips(points)).toHaveLength(1);
  });

  it("closeOpenAtEnd:false still emits trips that closed via dwell mid-stream", () => {
    // Drive A → 12.5-min destination stop → Drive B (still in progress).
    // Drive A closes via the dwell test BEFORE the end of the stream, so
    // it emits regardless of closeOpenAtEnd. Drive B is the tail; with
    // closeOpenAtEnd:false it's deferred.
    const points: GpsPoint[] = [];
    let t = 0;
    let north = 0;
    for (let i = 0; i < 20; i++) {
      points.push(pt(north, t));
      north += 100;
      t += 10 * SEC;
    }
    for (let i = 0; i < 25; i++) {
      points.push(pt(north, t));
      t += 30 * SEC;
    }
    for (let i = 0; i < 20; i++) {
      points.push(pt(north, t));
      north += 100;
      t += 10 * SEC;
    }
    const trips = segmentTrips(points, { closeOpenAtEnd: false });
    expect(trips).toHaveLength(1); // only Drive A (closed via dwell)
    expect(segmentTrips(points)).toHaveLength(2); // tail close gives both
  });
});

describe("suggestClassification", () => {
  const office: Place = {
    id: "o",
    kind: "office",
    lat: BASE_LAT,
    lng: BASE_LNG,
    radiusM: 120,
  };
  const home: Place = {
    id: "h",
    kind: "home",
    lat: BASE_LAT + 5000 / M_PER_DEG_LAT,
    lng: BASE_LNG,
    radiusM: 120,
  };

  const trip = (startN: number, endN: number) => ({
    startTs: 0,
    endTs: 1,
    points: [],
    distanceMiles: 3,
    startPoint: pt(startN, 0),
    endPoint: pt(endN, 1),
  });

  it("home → office is business", () => {
    expect(suggestClassification(trip(5000, 0), [home, office])).toBe(
      "business",
    );
  });

  it("home → home is personal", () => {
    const home2: Place = { ...home, id: "h2", lat: BASE_LAT };
    expect(suggestClassification(trip(0, 5000), [home2, home])).toBe(
      "personal",
    );
  });

  it("unknown endpoints are unclassified", () => {
    expect(suggestClassification(trip(99999, 88888), [home, office])).toBe(
      "unclassified",
    );
  });
});
