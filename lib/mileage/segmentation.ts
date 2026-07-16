// Mileage trip segmentation, the intellectual core.
//
// Pure functions: given an ordered stream of GPS points, produce
// driving "trips" (the breadcrumb trails) using the rule the
// business described:
//
//   - A trip is movement at vehicular speed, faster than a human
//     can sustainably run.
//   - A trip ENDS when the device becomes stationary (stays within
//     a small radius) for >= 5 minutes, OR there is a long capture
//     gap (GPS off / arrived).
//   - Tiny noise trips are discarded.
//
// No device, no DB, no network, 100% unit-testable. The native
// background-geolocation layer (a later phase, needs a build) only
// has to stream raw points to /api/mileage/ingest; ALL the
// intelligence lives here so it can be proven correct in CI.

export type GpsPoint = {
  lat: number;
  lng: number;
  /** Epoch milliseconds. */
  ts: number;
  /** Device-reported ground speed, m/s. Optional, we derive it
   *  from consecutive points when absent. */
  speedMps?: number;
  /** Horizontal accuracy in metres, if known (used to ignore
   *  jittery fixes). */
  accuracyM?: number;
};

export type Trip = {
  startTs: number;
  endTs: number;
  points: GpsPoint[];
  distanceMiles: number;
  startPoint: GpsPoint;
  endPoint: GpsPoint;
};

export type PlaceKind = "home" | "office" | "client" | "other";

export type Place = {
  id: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
  /** Geofence radius in metres. */
  radiusM: number;
  label?: string;
};

export type Classification = "business" | "personal" | "unclassified";

// --- Tunables (documented; safe to adjust with a test update) ---

/** Above this sustained speed the device is in a vehicle, not a
 *  person walking/running. Elite marathon pace ≈ 5.7 m/s; a short
 *  sprint peaks ~10-12 m/s but never sustains across GPS sampling.
 *  8 m/s ≈ 17.9 mph ≈ 28.8 km/h: comfortably vehicular, robust to
 *  a fast cyclist too. */
export const DRIVING_SPEED_MPS = 8;

/** Staying within this radius counts as "hasn't moved". */
export const STATIONARY_RADIUS_M = 60;

/** "Parked" threshold used OUTSIDE the segmenter. The ingest/finalizer
 *  treats a live trip as finished (and materializes it) once the most
 *  recent staged point is at least this old, i.e. the phone has gone
 *  quiet because the user parked. Kept short (5 min) so a finished
 *  drive shows up promptly. This is NOT what splits a drive mid-stream;
 *  that's TRIP_END_DWELL_MS. */
export const STATIONARY_DWELL_MS = 5 * 60 * 1000;

/** In-stream "the trip actually ended here" dwell. While segmenting a
 *  CONTINUOUS point stream, the open trip closes only once the vehicle
 *  has stayed within STATIONARY_RADIUS_M for at least this long. Set
 *  well above a normal traffic stop, gridlock, a long red light, a
 *  train crossing, a drawbridge, so sitting in traffic for several
 *  minutes does NOT chop one drive into several. A real destination
 *  stop lasts longer than this and still splits correctly.
 *
 *  Was 5 min, which mistook ~5-10 min traffic stops for arrivals and
 *  fragmented a single drive into multiple trips (user report, Jun 2026).
 *  Note: a genuine park where the phone then goes quiet still closes
 *  promptly via the ingest's STATIONARY_DWELL_MS parked-test + the
 *  closeOpenAtEnd tail-close, this longer dwell only matters while
 *  points keep arriving (which is exactly the traffic case). */
export const TRIP_END_DWELL_MS = 10 * 60 * 1000;

/** A capture gap longer than this also ends the open trip
 *  (phone slept / GPS revoked / arrived and app killed). */
export const MAX_CAPTURE_GAP_MS = 8 * 60 * 1000;

/** Trips shorter than this are GPS noise, not a drive. */
export const MIN_TRIP_METERS = 200;

export const METERS_PER_MILE = 1609.344;
const EARTH_RADIUS_M = 6_371_000;

type LatLng = { lat: number; lng: number };

/** Great-circle distance between two coordinates, in metres.
 *  Accepts anything with lat/lng (GpsPoint, Place, …). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Speed (m/s) implied by two consecutive points.
 *
 *  IMPORTANT (2026-05-26 forensic finding): the Android @capgo plugin
 *  has been observed to report `speed: 0` for every fix even during
 *  real driving. Production staging captured 195 fixes across 6 hours
 *  with `speed_mps = 0` for 190/195 of them, but the user was
 *  actually parked the whole time, so we couldn't tell which way the
 *  bug cut. The risk for the upcoming real drive: if the plugin
 *  reports 0 during movement, the previous version's `cur.speedMps
 *  >= 0` check returned 0 immediately and the haversine fallback was
 *  bypassed → segmenter never opens a trip → drive is lost.
 *
 *  New behavior: ONLY trust device speed when it's > 0. A device
 *  reporting exactly 0 is treated as "no speed information available"
 *  and we fall back to haversine-derived speed (which is genuinely 0
 *  if the user is stationary and genuinely high if they're moving).
 *  Both branches agree at rest, but the haversine branch is the only
 *  one that survives a buggy device reporting 0 during movement.
 */
function segmentSpeedMps(prev: GpsPoint, cur: GpsPoint): number {
  if (typeof cur.speedMps === "number" && cur.speedMps > 0) {
    return cur.speedMps;
  }
  const dtSec = (cur.ts - prev.ts) / 1000;
  if (dtSec <= 0) return 0;
  return haversineMeters(prev, cur) / dtSec;
}

function totalMeters(points: GpsPoint[]): number {
  let m = 0;
  for (let i = 1; i < points.length; i++) {
    m += haversineMeters(points[i - 1], points[i]);
  }
  return m;
}

/**
 * Segment an ordered point stream into driving trips.
 *
 * Points MUST be sorted ascending by `ts`. Out-of-order or
 * duplicate-timestamp points are tolerated (treated as zero-dt) but
 * the caller should sort first for correctness.
 *
 * Options:
 *   closeOpenAtEnd, when true (the default, matches the original
 *     behavior), any trip still open after the last point is
 *     force-closed and emitted. Used in test scenarios and when the
 *     caller is sure the stream is "complete". Set to FALSE when
 *     segmenting a still-growing live stream (e.g., a 30s heartbeat
 *     during an active drive), without this, the same in-progress
 *     trip gets emitted on every heartbeat, then re-emitted as a
 *     fragment as new points arrive, producing N tiny pieces instead
 *     of one continuous trip. The ingest endpoint should pass `false`
 *     while the user is still moving (last point is fresh) and `true`
 *     once the last point is old enough to indicate the user has
 *     parked.
 */
/** Fixes with reported horizontal accuracy worse than this are noise
 *  (urban-canyon multipath, cold-start cell fixes) and get dropped
 *  BEFORE segmentation. A 500 m jump from one bad fix reads as > 8 m/s
 *  "driving" and can open a phantom trip or inflate a real one's
 *  distance — the type has always documented accuracyM as "used to
 *  ignore jittery fixes", but nothing enforced it until now. */
export const MAX_ACCURACY_M = 100;

export function segmentTrips(
  points: GpsPoint[],
  options: { closeOpenAtEnd?: boolean } = {},
): Trip[] {
  const { closeOpenAtEnd = true } = options;
  const trips: Trip[] = [];
  points = points.filter(
    (p) => p.accuracyM == null || p.accuracyM <= MAX_ACCURACY_M,
  );
  if (points.length < 2) return trips;

  let current: GpsPoint[] = [];
  // Anchor for the stationary-dwell test: the first point at which
  // the device "settled". null when we're moving.
  let stationaryAnchor: GpsPoint | null = null;

  const closeTrip = (endIdxInclusive: number) => {
    if (current.length < 2) {
      current = [];
      stationaryAnchor = null;
      return;
    }
    const meters = totalMeters(current);
    if (meters >= MIN_TRIP_METERS) {
      trips.push({
        startTs: current[0].ts,
        endTs: current[current.length - 1].ts,
        points: current,
        distanceMiles: meters / METERS_PER_MILE,
        startPoint: current[0],
        endPoint: current[current.length - 1],
      });
    }
    current = [];
    stationaryAnchor = null;
    void endIdxInclusive;
  };

  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const gap = cur.ts - prev.ts;

    // Long capture gap → whatever trip was open has ended.
    if (gap > MAX_CAPTURE_GAP_MS) {
      closeTrip(i - 1);
      continue;
    }

    const speed = segmentSpeedMps(prev, cur);
    const moving = speed >= DRIVING_SPEED_MPS;

    if (moving) {
      // Driving. (Re)open a trip; clear any stationary anchor.
      stationaryAnchor = null;
      if (current.length === 0) current.push(prev);
      current.push(cur);
      continue;
    }

    // Not moving fast. If a trip is open, run the stationary-dwell
    // test: have we lingered near one spot for >= 5 minutes?
    if (current.length > 0) {
      if (
        !stationaryAnchor ||
        haversineMeters(stationaryAnchor, cur) > STATIONARY_RADIUS_M
      ) {
        // New settle point, restart the dwell clock here.
        stationaryAnchor = cur;
        // Still tack the point on; the trip's true end is the
        // anchor, trimmed below if the dwell completes.
        current.push(cur);
      } else {
        // Within the geofence of the anchor.
        if (cur.ts - stationaryAnchor.ts >= TRIP_END_DWELL_MS) {
          // Dwell satisfied → this was a real destination stop, not a
          // traffic pause (TRIP_END_DWELL_MS is set above a typical
          // jam/light). The trip ended when we first settled. Trim
          // trailing points that were just us sitting at the destination.
          while (
            current.length > 1 &&
            current[current.length - 1].ts > stationaryAnchor.ts
          ) {
            current.pop();
          }
          closeTrip(i);
        } else {
          current.push(cur);
        }
      }
    }
    // If no trip is open and we're slow, ignore (walking around).
  }

  // Stream ended with a trip still open (e.g., live tracking, or
  // the destination dwell never reached 5 min before data ran out).
  // The caller decides whether to materialize the tail (see options
  // doc above): a 30s heartbeat during a live drive passes
  // `closeOpenAtEnd: false` so the in-progress trip stays in staging;
  // a parked-≥5min heartbeat passes `true` so the trip finally lands.
  if (closeOpenAtEnd) {
    closeTrip(points.length - 1);
  }
  return trips;
}

/** Is a point inside a place's geofence? */
export function withinPlace(p: GpsPoint, place: Place): boolean {
  return haversineMeters(p, place) <= place.radiusM;
}

/**
 * Suggest a classification from known places. NOT authoritative -
 * the driver / account-manager confirms. Heuristic:
 *   - touches an office/client place at either end  → business
 *   - both ends are home                            → personal
 *   - otherwise                                     → unclassified
 */
export function suggestClassification(
  trip: Trip,
  places: Place[],
): Classification {
  const placeAt = (pt: GpsPoint) =>
    places.find((pl) => withinPlace(pt, pl)) ?? null;
  const start = placeAt(trip.startPoint);
  const end = placeAt(trip.endPoint);
  const isWork = (pl: Place | null) =>
    pl?.kind === "office" || pl?.kind === "client";
  if (isWork(start) || isWork(end)) return "business";
  if (start?.kind === "home" && end?.kind === "home") return "personal";
  return "unclassified";
}
