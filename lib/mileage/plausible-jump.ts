import { haversineMeters } from "./segmentation";

/**
 * Refuse a point that could not have been reached from the last accepted
 * one in the time available.
 *
 * WHY THIS EXISTS. On 2026-08-09 the owner's driver pool held two
 * interleaved copies of a single drive home, the second shifted about
 * sixteen minutes later than reality:
 *
 *   20:20:40.985  44.77954, -93.47072   Shakopee
 *   20:20:41.699  44.86004, -93.36702   Bloomington, 9 miles away
 *
 * Nine miles in 0.7 seconds is roughly 46,000 mph. Segmentation saw a
 * phone alternating between two places nine miles apart, produced
 * nonsense, and the downstream plausibility gate refused to write any of
 * it. 391 points sat unconsumed for six hours and the drive never
 * appeared on the map.
 *
 * The duplicate's origin is BELOW this codebase: every phantom timestamp
 * shares a .699 sub-second at a uniform 4.8 second cadence, the
 * signature of times reconstructed from a boot anchor inside the
 * background geolocation plugin's own buffer. That is not something we
 * can fix from here. What we can do is refuse to admit it, so one bad
 * source cannot cost a driver a day of real mileage.
 *
 * THE ASYMMETRY THAT SETS THE THRESHOLD. Rejecting a genuine point loses
 * a few metres of one drive. Accepting a teleport poisons segmentation
 * for the whole window and can lose the day. So the bar sits where no
 * car can reach it, and everything a car can actually do passes through
 * untouched.
 *
 * Deliberately NOT a distance test. A capture gap of twenty minutes
 * legitimately puts the next point nine miles away, and a distance-only
 * rule would throw away exactly the points that recover a drive after a
 * blackout. Only implied SPEED can tell the two apart.
 */

/** About 200 mph. Above anything a car does, far below a teleport. */
export const MAX_PLAUSIBLE_MPS = 89;

export type JumpPoint = {
  lat: number;
  lng: number;
  /** Epoch milliseconds. */
  ts: number;
};

export type RejectedJump<T> = {
  point: T;
  impliedMps: number;
  meters: number;
  seconds: number;
};

/**
 * Split a batch into the points that can be reached and the ones that
 * cannot.
 *
 * The reference advances only across ACCEPTED points. That is the whole
 * trick: with two interleaved streams, letting a rejected point become
 * the next reference would make the following genuine point look like a
 * teleport back, and the gate would then reject the real stream and keep
 * the phantom. Anchoring on the last accepted point means the coherent
 * stream survives and the intruder is shed.
 *
 * Points that arrive out of order (a negative elapsed) are KEPT. A late
 * point is normal in a batch upload, and reading a negative dt as an
 * infinite speed would discard valid data. Ordering is segmentation's
 * job, not this gate's.
 */
export function rejectImplausibleJumps<T extends JumpPoint>(
  points: readonly T[],
  previous: JumpPoint | null,
): { kept: T[]; rejected: RejectedJump<T>[] } {
  const kept: T[] = [];
  const rejected: RejectedJump<T>[] = [];
  let reference: JumpPoint | null = previous;

  for (const point of points) {
    if (!reference) {
      kept.push(point);
      reference = point;
      continue;
    }

    const meters = haversineMeters(reference, point);
    const seconds = (point.ts - reference.ts) / 1000;

    // Out of order, or the same instant in the same place. Neither is a
    // teleport. Note the same instant a long way away IS one, and falls
    // through to the speed test below with seconds === 0.
    if (seconds < 0 || (seconds === 0 && meters === 0)) {
      kept.push(point);
      // Deliberately does NOT advance the reference: an out-of-order
      // point would drag the anchor backwards and mis-judge the next one.
      continue;
    }

    // Same instant, real distance. Infinite implied speed, reported as a
    // large finite number so callers can log it without special cases.
    const impliedMps = seconds === 0 ? Number.MAX_SAFE_INTEGER : meters / seconds;

    if (impliedMps > MAX_PLAUSIBLE_MPS) {
      rejected.push({ point, impliedMps, meters, seconds });
      continue;
    }

    kept.push(point);
    reference = point;
  }

  return { kept, rejected };
}
