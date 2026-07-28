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
/** Accuracy worse than this never renders (segmentation keeps its own
 *  wider cap — detection and drawing have different stakes). */
export const RENDER_MAX_ACCURACY_M = 60;

/** Keep one anchor fix at least this often even inside the noise
 *  radius, so long dwells stay visible on the drawn track. */
export const JITTER_ANCHOR_MS = 60_000;

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
  const sorted = [...byTime.values()].sort((a, b) =>
    a.captured_at < b.captured_at ? -1 : a.captured_at > b.captured_at ? 1 : 0,
  );
  // Render-time jitter suppression (2026-07-27, "messy lines"). Fixes in
  // the 50-100m accuracy band pass the segmentation cap (rightly — they
  // still prove the phone was somewhere) but DRAWING them scribbles the
  // route: parked or slow-moving phones scatter inside their own GPS
  // error circle and the polyline zigzags through the noise, inflating
  // distance too. Two rules, applied only to the rendered track:
  //  - drop fixes worse than RENDER_MAX_ACCURACY_M outright;
  //  - drop a fix whose displacement from the last KEPT fix is smaller
  //    than the larger error radius of the pair (movement
  //    indistinguishable from noise), unless enough time passed that
  //    keeping an anchor beats dropping (dwell gaps stay visible).
  // Falls back to the unfiltered set when fewer than 2 points survive.
  const kept: typeof sorted = [];
  for (const p of sorted) {
    if ((p.accuracy_m ?? 0) > RENDER_MAX_ACCURACY_M) continue;
    const prev = kept[kept.length - 1];
    if (prev) {
      const jump = haversineMeters(prev, p);
      const noise = Math.max(prev.accuracy_m ?? 0, p.accuracy_m ?? 0);
      const dtMs =
        Date.parse(p.captured_at) - Date.parse(prev.captured_at);
      if (jump < noise && dtMs < JITTER_ANCHOR_MS) continue;
    }
    kept.push(p);
  }
  const points = kept.length >= 2 ? kept : sorted;
  let meters = 0;
  for (let i = 1; i < points.length; i++) {
    meters += haversineMeters(points[i - 1], points[i]);
  }
  return { points, distanceMiles: meters / METERS_PER_MILE };
}
