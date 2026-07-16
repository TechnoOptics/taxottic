import { haversineMeters, MAX_ACCURACY_M, METERS_PER_MILE } from "./segmentation";

/** A raw staging point as stored in mileage_points_raw. */
export type RawPoint = {
  captured_at: string;
  lat: number;
  lng: number;
  speed_mps: number | null;
  accuracy_m: number | null;
};

export type BuiltTrack = {
  /** De-duped, accuracy-filtered, time-ordered points to render. */
  points: RawPoint[];
  distanceMiles: number;
};

/**
 * Build a trip's rendered track from the raw staging points that fall in
 * its time window. This is the fix for the "straight line across no road"
 * bug: the finalizer used to render a trip from the in-memory segmentation
 * pool (which only ever saw the CURRENTLY-unconsumed points) while
 * consuming raw by time-range — so any point that arrived in a later flush
 * batch got marked consumed WITHOUT being drawn, leaving a straight hop.
 *
 * Rebuilding from every raw point inside the trip's own [start, end]
 * window is:
 *   - drift-free for healthy trips: the points the segmenter intentionally
 *     excludes (pre-drive idling, trimmed destination dwell) sit OUTSIDE
 *     [start, end], and low-accuracy junk is dropped here too, so a good
 *     trip rebuilds to exactly the same track it already had; and
 *   - corrective for broken trips: the orphaned mid-drive points are
 *     inside the window, so they finally get drawn.
 *
 * Dedup keeps the best-accuracy fix per timestamp. Points worse than
 * MAX_ACCURACY_M are dropped (same threshold as segmentation).
 */
export function buildTrackFromRaw(raw: readonly RawPoint[]): BuiltTrack {
  const byTime = new Map<string, RawPoint>();
  for (const p of raw) {
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    if (p.accuracy_m != null && p.accuracy_m > MAX_ACCURACY_M) continue;
    const existing = byTime.get(p.captured_at);
    if (
      !existing ||
      (p.accuracy_m ?? Infinity) < (existing.accuracy_m ?? Infinity)
    ) {
      byTime.set(p.captured_at, p);
    }
  }
  const points = [...byTime.values()].sort((a, b) =>
    a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : 0,
  );
  let meters = 0;
  for (let i = 1; i < points.length; i++) {
    meters += haversineMeters(points[i - 1], points[i]);
  }
  return { points, distanceMiles: meters / METERS_PER_MILE };
}
