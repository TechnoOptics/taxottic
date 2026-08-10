import { haversineMeters } from "./segmentation";

/**
 * Learned significant places, computed server-side from the raw points
 * we already hold.
 *
 * WHY THIS EXISTS
 *
 * A phone that has sat at home overnight with the app backgrounded is
 * routinely dead by morning: Android reclaims the process, or Samsung's
 * sleeping-apps policy restricts it after roughly three days of the app
 * not being opened (Samsung documents that state as restricting "Job,
 * Alarm, and Foreground-service"). Nothing then re-arms the foreground
 * service, so the first drive of the day is missed and every drive
 * after the user opens the app is captured perfectly. That is the exact
 * shape of both drivers' complaint.
 *
 * A platform geofence is delivered to a process the OS starts for the
 * purpose, so driving out of a geofence around home resurrects tracking
 * without anything of ours having survived the night. To register those
 * geofences we first have to know where home is, which is what this
 * file works out.
 *
 * WHY SERVER-SIDE
 *
 * The device holds at most a few thousand buffered points and loses
 * them on reinstall. The server holds tens of thousands per driver
 * across months. Clustering there is also free of battery cost, is
 * testable without a device, and produces one list that both Android
 * and iOS can consume.
 *
 * WHAT COUNTS AS A PLACE
 *
 * Not "somewhere the driver spent time", which raw GPS cannot tell you
 * because the tracker stops emitting when the vehicle is parked.
 * The observable signal is a TIME GAP in the point stream. Two
 * different things produce a gap, and they need different treatment:
 *
 *   1. A genuine dwell. The last point before the gap and the first
 *      point after it are in the same spot, so the vehicle sat there.
 *      Both ends are place evidence.
 *   2. A capture blackout, which is the bug. The two ends are far
 *      apart because a whole drive happened inside the silence. The
 *      point BEFORE the gap is still excellent evidence: it is where
 *      the phone was when tracking died, which is precisely the place
 *      we most want a geofence around. The point AFTER is mid-drive
 *      and is not a place at all.
 *
 * So every last-point-before-a-gap is a candidate, and a first-point-
 * after-a-gap is a candidate only when the gap was a genuine dwell.
 * Weighting candidates by gap duration makes an overnight home stop
 * outweigh a ten minute errand automatically, with no rule that names
 * "home".
 */

export type RawPoint = {
  lat: number;
  lng: number;
  /** Epoch milliseconds. */
  ts: number;
};

export type PlaceCandidate = {
  lat: number;
  lng: number;
  ts: number;
  /** Duration of the gap this candidate bounds, in milliseconds. */
  dwellMs: number;
  /**
   * The stop interval this candidate bounds, as epoch milliseconds.
   * Both ends of a confirmed dwell describe the SAME interval, which is
   * deliberate: home and work are told apart by which hours of the day
   * the vehicle sat still, and that is a property of the interval, not
   * of the instant a fix happened to be recorded. A phone that logs its
   * last fix at 22:00 and its next at 08:00 was at home all night, even
   * though neither timestamp is in the small hours.
   */
  startMs: number;
  endMs: number;
  /** True when the gap was a confirmed dwell rather than a blackout. */
  confirmedDwell: boolean;
};

export type LearnedPlaceLabel = "home" | "work" | "stop";

export type LearnedPlace = {
  /** Stable across recomputes so the device does not churn its mesh. */
  key: string;
  label: LearnedPlaceLabel;
  lat: number;
  lng: number;
  radiusM: number;
  visits: number;
  dwellHours: number;
  /** 0 is the most important place. */
  rank: number;
};

/**
 * A gap shorter than this is normal capture jitter (a tunnel, a
 * red light with the screen off, a flush cycle), not a stop. Ten
 * minutes matches TRIP_END_DWELL_MS in segmentation.ts so the two
 * layers agree on what "the vehicle stopped" means.
 */
export const MIN_GAP_MS = 10 * 60 * 1000;

/**
 * How far apart the two ends of a gap may be and still count as the
 * vehicle having stayed put. Generous enough to absorb parked GPS
 * drift, tight enough that a real drive inside the gap is never
 * mistaken for a dwell.
 */
export const DWELL_SAME_SPOT_M = 150;

/**
 * One stop contributes at most twelve hours of weight. Without a cap a
 * single fortnight-long holiday at an airport car park would outrank
 * home, which is visited nightly.
 */
export const MAX_DWELL_CREDIT_MS = 12 * 60 * 60 * 1000;

/** DBSCAN neighbourhood radius. Roughly a large car park. */
export const CLUSTER_EPS_M = 120;

/**
 * DBSCAN core-point threshold. Three separate stops is the smallest
 * number that distinguishes "habitual" from "went there once", which
 * matters because a one-off stop is not worth a permanent geofence.
 */
export const CLUSTER_MIN_POINTS = 3;

/**
 * Geofence radius bounds. Android geofencing is unreliable below about
 * 100 m, and 150 m at the low end is the figure that makes an exit fire
 * before the drive has meaningfully begun (significant-location-change
 * needs roughly 500 m). The upper bound stops a sprawling cluster from
 * covering half a neighbourhood, which would delay the wake.
 */
export const MIN_RADIUS_M = 150;
export const MAX_RADIUS_M = 250;

/**
 * How many places we keep.
 *
 * Not an Android limit (Android allows 100 geofences per app). It is
 * set by iOS, which caps region monitoring at 20 regions per app and
 * consumes this same list, by the standby power cost of each monitored
 * region, and by the fact that every spurious exit starts a location
 * foreground service. The value collapses after home and work: those
 * are where the phone sits still long enough for the process to die.
 * Eight covers home, work and the handful of habitual stops with
 * headroom.
 */
export const MAX_LEARNED_PLACES = 8;

/**
 * Local hours used to tell home from work.
 *
 * Local time is derived from longitude (15 degrees per hour) rather
 * than from a timezone database. This is an approximation: it ignores
 * daylight saving and political timezone borders, so it can be off by
 * up to about an hour and a half. That is immaterial here, because the
 * night window is five hours wide and home is where a driver is at
 * 03:00 under any plausible offset. It is deliberately not worth a
 * timezone dependency.
 */
const NIGHT_START_HOUR = 0;
const NIGHT_END_HOUR = 5;
const WORKDAY_START_HOUR = 9;
const WORKDAY_END_HOUR = 16;

const DAY_MS = 24 * 3600_000;

function localOffsetMs(lng: number): number {
  return Math.round(lng / 15) * 3600_000;
}

/**
 * How much of a stop interval falls inside a daily local-time window.
 *
 * Attributing a stop by the instant of one of its fixes is wrong and
 * was the first thing the tests caught: a phone whose last fix is at
 * 22:00 and whose next is at 08:00 sat at home through the entire
 * night, and neither of those two timestamps is in the small hours. The
 * overlap of the interval is the honest measure.
 */
function windowOverlapMs(
  startMs: number,
  endMs: number,
  lng: number,
  startHour: number,
  endHour: number,
  weekdaysOnly: boolean,
): number {
  if (endMs <= startMs) return 0;
  const offset = localOffsetMs(lng);
  const localStart = startMs + offset;
  const localEnd = endMs + offset;
  let total = 0;
  const firstDay = Math.floor(localStart / DAY_MS);
  const lastDay = Math.floor((localEnd - 1) / DAY_MS);
  for (let day = firstDay; day <= lastDay; day++) {
    const dayStart = day * DAY_MS;
    if (weekdaysOnly) {
      // 1970-01-01 was a Thursday, so day 0 is weekday 4.
      const weekday = (((day + 4) % 7) + 7) % 7;
      if (weekday === 0 || weekday === 6) continue;
    }
    const windowStart = dayStart + startHour * 3600_000;
    const windowEnd = dayStart + endHour * 3600_000;
    const overlap =
      Math.min(localEnd, windowEnd) - Math.max(localStart, windowStart);
    if (overlap > 0) total += overlap;
  }
  return total;
}

/** Local calendar day index, used to count distinct visits. */
function localDayIndex(ts: number, lng: number): number {
  return Math.floor((ts + localOffsetMs(lng)) / DAY_MS);
}

/**
 * How many separate days a place must be seen on before it earns a
 * geofence.
 *
 * Counted in DAYS, not in candidates. A single evening at a restaurant
 * produces three candidates on its own (arrival, departure, and the
 * departure that bounds the drive home), which is enough to satisfy
 * DBSCAN's core threshold. Registering a permanent geofence there would
 * spend a limited platform resource and generate spurious wakes for a
 * place the driver visited once. Three separate days is the smallest
 * number that means "habitual".
 */
export const MIN_VISIT_DAYS = 3;

/**
 * Pull place candidates out of one driver's raw point stream.
 * Points must be sorted ascending by ts; unsorted input is sorted here
 * because the caller reads from a database and ordering is easy to get
 * wrong.
 */
export function extractPlaceCandidates(points: RawPoint[]): PlaceCandidate[] {
  const sorted = [...points]
    .filter(
      (p) =>
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        Number.isFinite(p.ts) &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lng) <= 180,
    )
    .sort((a, b) => a.ts - b.ts);
  const out: PlaceCandidate[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const before = sorted[i - 1];
    const after = sorted[i];
    const gapMs = after.ts - before.ts;
    if (gapMs < MIN_GAP_MS) continue;
    const sameSpot = haversineMeters(before, after) <= DWELL_SAME_SPOT_M;
    // The point before the gap is always evidence: dwell or blackout,
    // that is where the vehicle was when the stream stopped.
    out.push({
      lat: before.lat,
      lng: before.lng,
      ts: before.ts,
      dwellMs: gapMs,
      startMs: before.ts,
      endMs: after.ts,
      confirmedDwell: sameSpot,
    });
    // The point after is evidence only if nothing moved during the gap.
    if (sameSpot) {
      out.push({
        lat: after.lat,
        lng: after.lng,
        ts: after.ts,
        dwellMs: gapMs,
        startMs: before.ts,
        endMs: after.ts,
        confirmedDwell: true,
      });
    }
  }
  // The final point of the whole stream bounds an open-ended stop that
  // has no "after" yet. It is where the vehicle is now, which for a
  // driver whose tracking just died is the most important place there
  // is. Credited with the minimum gap so it cannot dominate on its own.
  const last = sorted[sorted.length - 1];
  if (last) {
    out.push({
      lat: last.lat,
      lng: last.lng,
      ts: last.ts,
      dwellMs: MIN_GAP_MS,
      startMs: last.ts,
      endMs: last.ts + MIN_GAP_MS,
      confirmedDwell: false,
    });
  }
  return out;
}

/**
 * One trip reduced to its two endpoints.
 *
 * Deliberately not the trip row: this module is pure and must not learn
 * the database's column names. The route maps rows to this shape.
 */
export type TripSpan = {
  startLat: number;
  startLng: number;
  /** Epoch milliseconds. */
  startMs: number;
  endLat: number;
  endLng: number;
  /** Epoch milliseconds. */
  endMs: number;
};

/**
 * Dwell candidates derived from the gaps BETWEEN trips.
 *
 * A trip ending at a place, followed by a trip starting at the same
 * place, is a stop, and it is the same evidence that a gap between two
 * consecutive raw points gives. So the rules here mirror
 * extractPlaceCandidates exactly: at least MIN_GAP_MS, and confirmed only
 * when nothing moved (within DWELL_SAME_SPOT_M).
 *
 * Why this source exists at all: the raw-point path starves. Consumed
 * rows are deleted at 30 days against a 90 day clustering window, and raw
 * points are exactly what a failing tracker does not produce. Trips are
 * permanent. On the owner's 90 days, raw dwells produced ONE place while
 * endpoints produce three, covering 20 drive starts that had no geofence.
 *
 * Filtering to tracked-only trips is the CALLER's job, because this
 * module never sees a trip row. See the route.
 */
export function extractEndpointCandidates(trips: TripSpan[]): PlaceCandidate[] {
  const finite = (n: number) => Number.isFinite(n);
  const sorted = [...trips]
    .filter(
      (t) =>
        finite(t.startLat) &&
        finite(t.startLng) &&
        finite(t.endLat) &&
        finite(t.endLng) &&
        finite(t.startMs) &&
        finite(t.endMs) &&
        Math.abs(t.startLat) <= 90 &&
        Math.abs(t.endLat) <= 90 &&
        Math.abs(t.startLng) <= 180 &&
        Math.abs(t.endLng) <= 180,
    )
    .sort((a, b) => a.startMs - b.startMs);

  const out: PlaceCandidate[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const next = sorted[i];
    const gapMs = next.startMs - prev.endMs;
    if (gapMs < MIN_GAP_MS) continue;
    const sameSpot =
      haversineMeters(
        { lat: prev.endLat, lng: prev.endLng },
        { lat: next.startLat, lng: next.startLng },
      ) <= DWELL_SAME_SPOT_M;

    // Where the vehicle was when the drive ended: evidence either way.
    out.push({
      lat: prev.endLat,
      lng: prev.endLng,
      ts: prev.endMs,
      dwellMs: gapMs,
      startMs: prev.endMs,
      endMs: next.startMs,
      confirmedDwell: sameSpot,
    });
    // Where the next drive began is evidence only if nothing moved.
    if (sameSpot) {
      out.push({
        lat: next.startLat,
        lng: next.startLng,
        ts: next.startMs,
        dwellMs: gapMs,
        startMs: prev.endMs,
        endMs: next.startMs,
        confirmedDwell: true,
      });
    }
  }

  // The last trip's end bounds an open stop with no "after" yet. That is
  // where the vehicle is now, which for a driver whose tracking just died
  // is the most valuable place there is. Minimum credit so it cannot
  // dominate on its own.
  const last = sorted[sorted.length - 1];
  if (last) {
    out.push({
      lat: last.endLat,
      lng: last.endLng,
      ts: last.endMs,
      dwellMs: MIN_GAP_MS,
      startMs: last.endMs,
      endMs: last.endMs + MIN_GAP_MS,
      confirmedDwell: false,
    });
  }
  return out;
}

type Cluster = {
  members: PlaceCandidate[];
  lat: number;
  lng: number;
  radiusM: number;
  dwellMs: number;
  nightDwellMs: number;
  workdayDwellMs: number;
  visits: number;
};

/**
 * DBSCAN over candidates with a haversine metric.
 *
 * DBSCAN rather than k-means because the number of places is not known
 * in advance, the clusters are not spherical in any meaningful sense,
 * and, most importantly, DBSCAN has a notion of noise: a one-off stop
 * at a restaurant should be discarded, not folded into the nearest
 * cluster and allowed to drag its centroid off the driveway. k-means
 * would have to be told how many places exist and would place a
 * centroid somewhere between home and the shop.
 *
 * Quadratic in the number of candidates. Candidates are gap-bounded
 * points, so tens of thousands of raw points reduce to hundreds, and
 * the quadratic term is not worth a spatial index.
 */
export function clusterCandidates(candidates: PlaceCandidate[]): Cluster[] {
  const n = candidates.length;
  const UNVISITED = 0;
  const VISITED = 1;
  const state = new Uint8Array(n);
  const assigned = new Int32Array(n).fill(-1);
  const clusters: PlaceCandidate[][] = [];

  const neighbours = (i: number): number[] => {
    const found: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (haversineMeters(candidates[i], candidates[j]) <= CLUSTER_EPS_M) {
        found.push(j);
      }
    }
    return found;
  };

  for (let i = 0; i < n; i++) {
    if (state[i] !== UNVISITED) continue;
    state[i] = VISITED;
    const seeds = neighbours(i);
    if (seeds.length + 1 < CLUSTER_MIN_POINTS) continue; // noise, for now
    const clusterIndex = clusters.length;
    clusters.push([candidates[i]]);
    assigned[i] = clusterIndex;
    const queue = [...seeds];
    for (let q = 0; q < queue.length; q++) {
      const j = queue[q];
      if (state[j] === UNVISITED) {
        state[j] = VISITED;
        const more = neighbours(j);
        if (more.length + 1 >= CLUSTER_MIN_POINTS) {
          for (const k of more) if (!queue.includes(k)) queue.push(k);
        }
      }
      if (assigned[j] === -1) {
        assigned[j] = clusterIndex;
        clusters[clusterIndex].push(candidates[j]);
      }
    }
  }

  return clusters.map((members) => summarize(members));
}

function summarize(members: PlaceCandidate[]): Cluster {
  const lat = members.reduce((a, m) => a + m.lat, 0) / members.length;
  const lng = members.reduce((a, m) => a + m.lng, 0) / members.length;
  const centre = { lat, lng };
  const distances = members
    .map((m) => haversineMeters(centre, m))
    .sort((a, b) => a - b);
  // p90 rather than max: one bad fix at the edge of a car park should
  // not inflate the geofence and delay every future wake.
  const p90 = distances[Math.min(distances.length - 1, Math.floor(distances.length * 0.9))] ?? 0;
  const radiusM = Math.round(
    Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, p90 + 40)),
  );

  let dwellMs = 0;
  let nightDwellMs = 0;
  let workdayDwellMs = 0;
  const days = new Set<number>();
  for (const m of members) {
    // Cap the interval, not just the credit: an uncapped month-long
    // airport stop would otherwise contribute a month of night hours
    // and outrank a home that is visited every single night.
    const start = m.startMs;
    const end = Math.min(m.endMs, m.startMs + MAX_DWELL_CREDIT_MS);
    dwellMs += Math.min(m.dwellMs, MAX_DWELL_CREDIT_MS);
    nightDwellMs += windowOverlapMs(
      start,
      end,
      m.lng,
      NIGHT_START_HOUR,
      NIGHT_END_HOUR,
      false,
    );
    workdayDwellMs += windowOverlapMs(
      start,
      end,
      m.lng,
      WORKDAY_START_HOUR,
      WORKDAY_END_HOUR,
      true,
    );
    days.add(localDayIndex(m.ts, m.lng));
  }

  return {
    members,
    lat,
    lng,
    radiusM,
    dwellMs,
    nightDwellMs,
    workdayDwellMs,
    // Distinct local days, not candidate count. See MIN_VISIT_DAYS.
    visits: days.size,
  };
}

/**
 * Stable identity for a cluster. Three decimal places is about 110 m,
 * comfortably coarser than the drift a centroid experiences between
 * recomputes, so the same driveway keeps the same key and the device
 * does not tear down and rebuild its mesh for nothing.
 */
export function placeKey(lat: number, lng: number): string {
  return `p${lat.toFixed(3)}_${lng.toFixed(3)}`;
}

/**
 * The whole pipeline: raw points in, ranked geofence list out.
 */
export function learnPlaces(points: RawPoint[]): LearnedPlace[] {
  // Habitual only. A place seen on fewer than MIN_VISIT_DAYS separate
  // days does not earn one of a strictly limited number of platform
  // region registrations.
  const clusters = clusterCandidates(extractPlaceCandidates(points)).filter(
    (c) => c.visits >= MIN_VISIT_DAYS,
  );
  if (clusters.length === 0) return [];

  // Home is where the driver is in the small hours. It is the single
  // most valuable geofence, because an overnight stop is what kills the
  // process in the first place.
  let homeIndex = -1;
  let bestNight = 0;
  clusters.forEach((c, i) => {
    if (c.nightDwellMs > bestNight) {
      bestNight = c.nightDwellMs;
      homeIndex = i;
    }
  });

  // Work is the strongest weekday-daytime cluster that is not home.
  let workIndex = -1;
  let bestWorkday = 0;
  clusters.forEach((c, i) => {
    if (i === homeIndex) return;
    if (c.workdayDwellMs > bestWorkday) {
      bestWorkday = c.workdayDwellMs;
      workIndex = i;
    }
  });

  const ordered = clusters
    .map((c, i) => ({
      cluster: c,
      index: i,
      label: (i === homeIndex ? "home" : i === workIndex ? "work" : "stop") as LearnedPlaceLabel,
    }))
    .sort((a, b) => {
      const priority = (label: LearnedPlaceLabel) =>
        label === "home" ? 0 : label === "work" ? 1 : 2;
      const byLabel = priority(a.label) - priority(b.label);
      if (byLabel !== 0) return byLabel;
      return b.cluster.dwellMs - a.cluster.dwellMs;
    })
    .slice(0, MAX_LEARNED_PLACES);

  return ordered.map((entry, rank) => ({
    key: placeKey(entry.cluster.lat, entry.cluster.lng),
    label: entry.label,
    lat: entry.cluster.lat,
    lng: entry.cluster.lng,
    radiusM: entry.cluster.radiusM,
    visits: entry.cluster.visits,
    dwellHours: Math.round((entry.cluster.dwellMs / 3600_000) * 100) / 100,
    rank,
  }));
}
