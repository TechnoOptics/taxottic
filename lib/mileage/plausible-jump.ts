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

/**
 * How far either side of an incoming batch the caller should look for
 * stored points to judge it against.
 *
 * Set by the bar above, not by taste: at 89 m/s, fifteen minutes reaches
 * 80 km. A stored point further away in time than that cannot make
 * anything inside the batch implausible, so fetching it would cost rows
 * and prove nothing.
 */
export const NEIGHBOUR_WINDOW_MS = 15 * 60_000;

/**
 * Row cap for that read. The device captures at roughly 4.8 s, so a full
 * day is about 18,000 rows and this sits above it. Fetch ascending: a
 * truncated read then still witnesses the earlier part of a long backlog
 * and degrades to a predecessor-only check after that, rather than
 * losing the window entirely.
 */
export const NEIGHBOUR_ROW_CAP = 20_000;

export type JumpPoint = {
  lat: number;
  lng: number;
  /** Epoch milliseconds. */
  ts: number;
};

/**
 * Which of the three checks refused a point. Logged, so that a
 * production rejection says whether one stray fix was shed ("batch") or
 * a whole second delivery was turned away ("stored" plus "run"). Those
 * are different faults and want different responses.
 */
export type JumpRejectionReason = "batch" | "stored" | "run";

export type RejectedJump<T> = {
  point: T;
  impliedMps: number;
  meters: number;
  seconds: number;
  reason: JumpRejectionReason;
};

/**
 * Implied speed between two points, direction-agnostic.
 *
 * Same instant in the same place is a repeat, not a teleport, so it
 * reads as zero. Same instant a real distance apart is infinite,
 * reported as a large finite number so callers can log it plainly.
 */
function impliedSpeed(
  a: JumpPoint,
  b: JumpPoint,
): { meters: number; seconds: number; mps: number } {
  const meters = haversineMeters(a, b);
  const seconds = Math.abs(b.ts - a.ts) / 1000;
  if (seconds === 0) {
    return { meters, seconds, mps: meters === 0 ? 0 : Number.MAX_SAFE_INTEGER };
  }
  return { meters, seconds, mps: meters / seconds };
}

/** First index of `sorted` whose ts is >= ts. */
function lowerBound(sorted: readonly JumpPoint[], ts: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].ts < ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** First index of `sorted` whose ts is > ts. */
function upperBound(sorted: readonly JumpPoint[], ts: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].ts <= ts) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

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
 *
 * `stored` closes the blind spot the batch-only view leaves. See
 * checkAgainstStored below.
 */
export function rejectImplausibleJumps<T extends JumpPoint>(
  points: readonly T[],
  previous: JumpPoint | null,
  stored: readonly JumpPoint[] = [],
): { kept: T[]; rejected: RejectedJump<T>[] } {
  // One slot per incoming point: null means kept so far. Later passes
  // only ever add refusals, never take one back, so the guarantee only
  // strengthens as we go.
  const verdict: (RejectedJump<T> | null)[] = points.map(() => null);

  checkWithinBatch(points, previous, verdict);
  const displaced = checkAgainstStored(points, stored, verdict);
  if (displaced) followRefusedRun(points, verdict);

  const kept: T[] = [];
  const rejected: RejectedJump<T>[] = [];
  points.forEach((point, i) => {
    const bad = verdict[i];
    if (bad) rejected.push(bad);
    else kept.push(point);
  });
  return { kept, rejected };
}

/** Pass one: each point against the last ACCEPTED point before it. */
function checkWithinBatch<T extends JumpPoint>(
  points: readonly T[],
  previous: JumpPoint | null,
  verdict: (RejectedJump<T> | null)[],
): void {
  let reference: JumpPoint | null = previous;

  points.forEach((point, i) => {
    if (!reference) {
      reference = point;
      return;
    }

    const meters = haversineMeters(reference, point);
    const seconds = (point.ts - reference.ts) / 1000;

    // Out of order, or the same instant in the same place. Neither is a
    // teleport. Note the same instant a long way away IS one, and falls
    // through to the speed test below with seconds === 0.
    if (seconds < 0 || (seconds === 0 && meters === 0)) {
      // Deliberately does NOT advance the reference: an out-of-order
      // point would drag the anchor backwards and mis-judge the next one.
      return;
    }

    // Same instant, real distance. Infinite implied speed, reported as a
    // large finite number so callers can log it without special cases.
    const impliedMps = seconds === 0 ? Number.MAX_SAFE_INTEGER : meters / seconds;

    if (impliedMps > MAX_PLAUSIBLE_MPS) {
      verdict[i] = { point, impliedMps, meters, seconds, reason: "batch" };
      return;
    }

    reference = point;
  });
}

/**
 * Pass two: each point against the stored points it lands BETWEEN.
 *
 * WHY THIS EXISTS, measured 2026-08-17 on driver 89871e98. A drive
 * uploaded live on whole-second timestamps. Twenty-six minutes later the
 * native buffer replayed the same drive twice more, on .297 and .928
 * sub-second offsets, every timestamp pushed about three minutes later
 * than reality. The 631 ms between the replays defeats the
 * (driver, company, captured_at) upsert key outright, so both copies
 * were stored.
 *
 * Pass one could not see it. The replay batch was wholly older than the
 * newest stored point, so the route drops the anchor by design (a
 * backlog must self-anchor, see the ingest route), and the replay is
 * internally flawless. The teleport existed ONLY between the batch and
 * the rows it interleaved with: 1,263 of 3,351 merged transitions over
 * 60 m/s, worst 88,783 m/s, segmenting to one 1,527 mi / 25 min trip
 * that the trip gate refused, freezing the pool permanently.
 *
 * ALL EXISTING NEIGHBOURS MUST BE IMPLAUSIBLE, not merely one. The
 * pools this ships into already hold contaminated rows, and a rule that
 * condemned a point for one bad neighbour would start destroying the
 * live stream instead of merely refusing the replay. A genuinely
 * delivered point has a genuine neighbour on at least one side; a point
 * delivered from somewhere else has neither.
 *
 * Returns whether the batch as a whole reads as DISPLACED from storage,
 * which is what a second delivery path looks like and what licenses the
 * run rule below.
 */
function checkAgainstStored<T extends JumpPoint>(
  points: readonly T[],
  stored: readonly JumpPoint[],
  verdict: (RejectedJump<T> | null)[],
): boolean {
  if (stored.length === 0) return false;
  // Sorted here rather than trusted: a mis-ordered pool would pick the
  // wrong neighbour and fail open, silently.
  const sorted = [...stored].sort((a, b) => a.ts - b.ts);

  let examined = 0;
  let refused = 0;

  points.forEach((point, i) => {
    if (verdict[i]) return;

    // Strictly before and strictly after. A stored row at exactly this
    // captured_at is what the upsert key already dedupes, so it is a
    // retried flush, not a second source, and is not a witness.
    const before = lowerBound(sorted, point.ts) - 1;
    const after = upperBound(sorted, point.ts);
    const witnesses = [
      before >= 0 ? impliedSpeed(sorted[before], point) : null,
      after < sorted.length ? impliedSpeed(point, sorted[after]) : null,
    ].filter((w) => w !== null);
    if (witnesses.length === 0) return;

    examined++;
    if (!witnesses.every((w) => w.mps > MAX_PLAUSIBLE_MPS)) return;

    refused++;
    const worst = witnesses.reduce((a, b) => (a.mps > b.mps ? a : b));
    verdict[i] = {
      point,
      impliedMps: worst.mps,
      meters: worst.meters,
      seconds: worst.seconds,
      reason: "stored",
    };
  });

  return examined > 0 && refused * 2 > examined;
}

/**
 * Pass three: refuse the rest of a delivery most of which was refused.
 *
 * A point-by-point speed test cannot finish this job on its own. The
 * replay is time-SHIFTED, so parts of it run clear of the live stream
 * and converge on positions the car really did occupy. Judged one point
 * at a time those are reachable at an ordinary speed, so they are
 * admitted, and they segment into a completely innocent-looking drive
 * the car never took.
 *
 * MEASURED on the 2026-08-17 pool, replaying the real deliveries in
 * their real upload order: the per-point test alone refuses 1,081 of
 * 1,630 replayed points and admits 549, which segment to 26.83 mi
 * against a true 19.56 at a thoroughly plausible 65 mph. That is a 37%
 * fabrication, worse than the 18% a naive merged-stream speed gate
 * produces, and worse than the frozen pool it would replace: a missing
 * mile is visible to the driver, an invented one is not. With this rule
 * the same replay is refused whole and the pool renders 19.56 mi at
 * 54 mph, exactly the live stream's own figure.
 *
 * So a refused point spreads to the batch neighbours it is geometrically
 * CONTINUOUS with, forwards and backwards. Continuity is the whole
 * safeguard: a single stray fix is by definition nowhere near the points
 * either side of it, so nothing spreads from it, while a replayed drive
 * is continuous along its entire length and goes as one.
 *
 * Only runs when the batch is displaced from storage on balance (see
 * above). A batch that agrees with storage everywhere except one
 * contaminated pocket is a genuine upload crossing old damage, and
 * spreading a refusal through it would eat the upload whole. On the
 * measured replay the direct refusals were 66% of the points examined,
 * comfortably clear of the half it has to beat; a genuine batch grazing
 * one contaminated pocket refuses a handful of points out of hundreds.
 */
function followRefusedRun<T extends JumpPoint>(
  points: readonly T[],
  verdict: (RejectedJump<T> | null)[],
): void {
  const spread = (i: number, from: number) => {
    if (verdict[i] || !verdict[from]) return;
    const { meters, seconds, mps } = impliedSpeed(points[from], points[i]);
    if (mps > MAX_PLAUSIBLE_MPS) return;
    verdict[i] = { point: points[i], impliedMps: mps, meters, seconds, reason: "run" };
  };

  for (let i = 1; i < points.length; i++) spread(i, i - 1);
  for (let i = points.length - 2; i >= 0; i--) spread(i, i + 1);
}
