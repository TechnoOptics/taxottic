import { haversineMeters, METERS_PER_MILE } from "./segmentation";

/**
 * Stitch back drives that finalize severed on an upload stall.
 *
 * THE SIGNATURE. A severed drive leaves two trips where the second starts
 * SECONDS after the first ended, from essentially the same spot, because
 * the two halves are one continuous GPS stream that reached the server in
 * two batches. On 2026-08-09 three drives were cut this way, each seam six
 * seconds wide, each landing exactly on an upload stall boundary.
 *
 * Nothing else looks like that. Segmentation ends a trip only on a 10
 * minute stationary dwell or an 8 minute capture gap, so any pair
 * separated by seconds was ALREADY one drive by the pipeline's own rules,
 * and re-joining it asserts nothing new.
 *
 * BOTH conditions are required, and the spatial one is what keeps this
 * honest. A time-only rule would weld together trips that begin miles
 * apart and invent the mileage between them. Inventing deductible
 * distance is a worse failure than leaving a drive in two pieces: the
 * split is visible to the driver and merely annoying, whereas fabricated
 * miles are invisible and end up on a tax return.
 *
 * The merged distance is the two measured distances plus the real
 * displacement across the seam, computed from the two actual GPS
 * endpoints. The seam is bounded by FRAGMENT_MAX_JUMP_M, so the added
 * term is at most a few hundred metres of genuinely observed movement.
 */

/**
 * Widest seam treated as a severed drive rather than a real stop.
 *
 * Two minutes is far below TRIP_END_DWELL_MS (ten), which is the interval
 * that DEFINES a destination stop. Anything at or above the dwell is a
 * stop segmentation would have honoured, and merging it would erase a
 * real one.
 */
export const FRAGMENT_MAX_GAP_MS = 2 * 60_000;

/**
 * Widest spatial jump across the seam. A severed drive resumes from where
 * it was cut; 400 m covers GPS scatter at speed without letting two
 * genuinely distant trips join.
 */
export const FRAGMENT_MAX_JUMP_M = 400;

export type FragmentTrip = {
  id: string;
  startedAtMs: number;
  endedAtMs: number;
  distanceMiles: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
};

export type MergePlan = {
  /** The trip row that survives and is widened. */
  keepId: string;
  /** Rows folded into it and then deleted. In chronological order. */
  absorbIds: string[];
  /** New ended_at for the surviving row. */
  endedAtMs: number;
  /** Measured distances plus the measured seams. Never an estimate. */
  distanceMiles: number;
};

/** True when `next` is the continuation of `prev`, not a new drive. */
function isSeam(prev: FragmentTrip, next: FragmentTrip): boolean {
  const gapMs = next.startedAtMs - prev.endedAtMs;
  // Negative means the two overlap in time; merging would double-count.
  if (gapMs < 0 || gapMs > FRAGMENT_MAX_GAP_MS) return false;
  const jumpM = haversineMeters(
    { lat: prev.endLat, lng: prev.endLng },
    { lat: next.startLat, lng: next.startLng },
  );
  return jumpM <= FRAGMENT_MAX_JUMP_M;
}

/**
 * Group severed fragments into merge plans.
 *
 * Chronological, chaining greedily: a drive cut twice yields three
 * fragments and one plan. Trips with no seam either side are absent from
 * the result entirely, so an empty array means there is nothing to do.
 */
export function planFragmentMerges(trips: FragmentTrip[]): MergePlan[] {
  const sorted = [...trips].sort((a, b) => a.startedAtMs - b.startedAtMs);
  const plans: MergePlan[] = [];

  let i = 0;
  while (i < sorted.length) {
    const head = sorted[i];
    let last = head;
    let miles = head.distanceMiles;
    const absorbIds: string[] = [];

    let j = i + 1;
    while (j < sorted.length && isSeam(last, sorted[j])) {
      const next = sorted[j];
      const seamM = haversineMeters(
        { lat: last.endLat, lng: last.endLng },
        { lat: next.startLat, lng: next.startLng },
      );
      miles += next.distanceMiles + seamM / METERS_PER_MILE;
      absorbIds.push(next.id);
      last = next;
      j++;
    }

    if (absorbIds.length > 0) {
      plans.push({
        keepId: head.id,
        absorbIds,
        endedAtMs: last.endedAtMs,
        // Round to the same precision the trips table stores.
        distanceMiles: Math.round(miles * 1000) / 1000,
      });
    }
    i = j;
  }

  return plans;
}
