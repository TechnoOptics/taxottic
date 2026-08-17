import {
  haversineMeters,
  MAX_CAPTURE_GAP_MS,
  segmentTrips,
  TRIP_END_DWELL_MS,
} from "./segmentation";
import { isPlausibleTrip } from "./finalize";
import type { GpsPoint } from "./segmentation";
import { MAX_PLAUSIBLE_MPS } from "./plausible-jump";

/**
 * Honest accounting for the "Recover lost drives" control.
 *
 * The control exists because a drive can sit in mileage_points_raw and
 * never reach the map. The live ingest path only ever re-segments the
 * last 24 hours, so once a drive ages past that it is invisible to every
 * code path except the finalize cron.
 *
 * What this module does NOT do is decide anything about distance. It
 * classifies why a stretch of staged points has not become a trip, so the
 * control can tell the driver the truth instead of a reassuring number.
 * That distinction is the entire design, because the measured pool on
 * 2026-08-17 held two completely different things under one count of
 * 21,117 "unconsumed" points:
 *
 *   ~18,300  a parked phone emitting fixes for 41 days. These never
 *            displace 200 m, so the segmenter correctly makes no trip
 *            from them and they are never consumed. They are not lost
 *            drives and reporting them as such would invent a problem.
 *
 *    ~3,556  one real 19.56 mi drive delivered THREE times over (a live
 *            whole-second stream plus two replayed copies), interleaved
 *            so consecutive rows alternate between points 4.6 km apart.
 *            1,263 of 3,351 transitions implied over 60 m/s, the worst
 *            88,783 m/s (about 198,000 mph). Summed, that is 1,527 miles
 *            in 25 minutes, which isPlausibleTrip correctly refuses.
 *
 * The second is a drive the driver is genuinely owed, and it is exactly
 * the case where a recovery sweep must NOT quietly produce a number.
 * Measured: dropping the implausible transitions and segmenting what
 * survives yields 23.14 mi against a true 19.56 mi, an 18% fabrication
 * that looks perfectly plausible at 56 mph average. So contamination is
 * reported and refused, never silently repaired.
 */

/**
 * How far back a recovery sweep looks.
 *
 * Wider than the live ingest's 24 hours, which is what strands a drive in
 * the first place, and no wider than the retention cron's 45-day sweep,
 * beyond which the rows have already been tombstoned.
 */
export const RECOVERY_WINDOW_DAYS = 45;

/** Implied speed above which a transition is a delivery artefact rather
 *  than travel. Reuses the ingest gate's own threshold so the control and
 *  the door it guards can never disagree about what a teleport is. */
const TELEPORT_MPS = MAX_PLAUSIBLE_MPS;

const MPH_PER_MPS = 2.236936;

export type RecoveryVerdict =
  | { kind: "stationary"; points: number; startTs: number; endTs: number }
  | { kind: "recoverable"; points: number; startTs: number; endTs: number }
  | { kind: "recording"; points: number; startTs: number; endTs: number }
  | {
      kind: "contaminated";
      points: number;
      startTs: number;
      endTs: number;
      jumps: number;
      worstMph: number;
    };

/**
 * Split a staged pool wherever capture stopped for longer than the
 * segmenter's own capture-gap threshold. Using the segmenter's constant
 * rather than a number of our own is deliberate: a cluster here should
 * correspond to something the segmenter would consider one continuous
 * stretch, or the diagnosis would be describing a grouping the pipeline
 * does not share.
 */
export function clusterByCaptureGap<T extends GpsPoint>(
  points: readonly T[],
  gapMs: number = MAX_CAPTURE_GAP_MS,
): T[][] {
  const clusters: T[][] = [];
  let current: T[] = [];
  for (const p of points) {
    const prev = current[current.length - 1];
    if (prev && p.ts - prev.ts > gapMs) {
      clusters.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length > 0) clusters.push(current);
  return clusters;
}

/**
 * Why has this stretch of staged points not become a trip?
 *
 * Order matters and is not arbitrary:
 *
 *  1. Contamination first. A pool holding impossible transitions cannot
 *     be reasoned about at all. Its displacement is meaningless, so any
 *     "did it move far enough" test computed over it is answering a
 *     question about corrupt data. It is also the only verdict that
 *     names something a human can act on.
 *  2. Then "still recording", so a drive in progress is never described
 *     as lost. On 2026-08-17 the driver's newest point was 37 seconds
 *     old while they were asking where the drive had gone.
 *  3. Then stationary, the parked-phone residue.
 *  4. Anything left is a drive that should have materialised.
 */
export function diagnoseCluster(
  points: readonly GpsPoint[],
  nowMs: number,
): RecoveryVerdict {
  const startTs = points.length > 0 ? points[0].ts : 0;
  const endTs = points.length > 0 ? points[points.length - 1].ts : 0;
  const base = { points: points.length, startTs, endTs };

  let jumps = 0;
  let worstMps = 0;
  for (let i = 1; i < points.length; i++) {
    const seconds = (points[i].ts - points[i - 1].ts) / 1000;
    const meters = haversineMeters(points[i - 1], points[i]);
    const impliedMps =
      seconds <= 0 ? Number.MAX_SAFE_INTEGER : meters / seconds;
    if (impliedMps > TELEPORT_MPS) {
      jumps++;
      if (impliedMps > worstMps) worstMps = impliedMps;
    }
  }
  if (jumps > 0) {
    return {
      kind: "contaminated",
      ...base,
      jumps,
      worstMph: Math.round(worstMps * MPH_PER_MPS),
    };
  }

  if (points.length > 0 && nowMs - endTs < TRIP_END_DWELL_MS) {
    return { kind: "recording", ...base };
  }

  // Ask the SEGMENTER, do not approximate it.
  //
  // This started life as "did the cluster ever get MIN_TRIP_METERS from
  // its first point", which is a plausible-sounding proxy and is wrong.
  // Measured against this driver's real pool it labelled 1,619 points
  // across 8 clusters "recoverable" that segmentTrips produces no trip
  // from at all: a phone drifting 300 m over fifteen hours clears a
  // displacement test and is still not a drive. The control would then
  // have reported a permanent "this is unexpected, please report it" at
  // a driver who had nothing to report.
  //
  // Running the real segmenter makes the verdict agree with the pipeline
  // by construction, which is the only way it can stay true as the
  // segmenter's own rules move.
  const trips = segmentTrips([...points], { closeOpenAtEnd: true });
  const usable = trips.filter((t) =>
    isPlausibleTrip(t.distanceMiles, t.startTs, t.endTs),
  );
  if (usable.length === 0) {
    return { kind: "stationary", ...base };
  }

  return { kind: "recoverable", ...base };
}

/**
 * May the recovery sweep force the tail-close?
 *
 * It must be able to. A drive whose device went dark without ever
 * dwelling cannot close on its own, and a recovery control that cannot
 * close it is decorative.
 *
 * But forcing the close while the driver is still driving severs the live
 * drive at whatever point last reached the server, and the remainder
 * becomes a second trip. That is the fragmentation `TRIP_END_DWELL_MS`
 * was widened to stop, and it under-reports the deduction every time.
 * A driver tapping "recover my missing drive" while driving home is the
 * likeliest way this control is ever used, so the unsafe case is the
 * common one, not the edge.
 *
 * So: force only once the newest staged point is older than the
 * segmenter's own dwell. In-progress drives are reported as still
 * recording instead, which is both true and reassuring.
 */
export function shouldForceCloseRecovery(args: {
  /** captured_at of the newest unconsumed point, epoch ms, or null when
   *  nothing is staged. */
  newestUnconsumedTs: number | null;
  nowMs: number;
}): boolean {
  if (args.newestUnconsumedTs === null) return true;
  return args.nowMs - args.newestUnconsumedTs >= TRIP_END_DWELL_MS;
}

export type RecoverySummary = {
  totalPoints: number;
  stationaryPoints: number;
  recoverablePoints: number;
  recordingPoints: number;
  contaminatedPoints: number;
  contaminatedClusters: number;
  /** Worst implied speed across every contaminated cluster, mph. 0 when
   *  nothing is contaminated. */
  worstMph: number;
  /** Span of the contaminated stretches, so the report can name WHEN. */
  contaminatedSpans: Array<{ startTs: number; endTs: number; points: number }>;
};

/** Roll per-cluster verdicts into the figures the control reports. Every
 *  point given must land in exactly one bucket: a recovery report whose
 *  parts do not sum to its total is the failure mode this whole control
 *  exists to avoid. */
export function summariseRecovery(
  clusters: readonly (readonly GpsPoint[])[],
  nowMs: number,
): RecoverySummary {
  const summary: RecoverySummary = {
    totalPoints: 0,
    stationaryPoints: 0,
    recoverablePoints: 0,
    recordingPoints: 0,
    contaminatedPoints: 0,
    contaminatedClusters: 0,
    worstMph: 0,
    contaminatedSpans: [],
  };
  for (const cluster of clusters) {
    const verdict = diagnoseCluster(cluster, nowMs);
    summary.totalPoints += verdict.points;
    switch (verdict.kind) {
      case "stationary":
        summary.stationaryPoints += verdict.points;
        break;
      case "recoverable":
        summary.recoverablePoints += verdict.points;
        break;
      case "recording":
        summary.recordingPoints += verdict.points;
        break;
      case "contaminated":
        summary.contaminatedPoints += verdict.points;
        summary.contaminatedClusters++;
        if (verdict.worstMph > summary.worstMph) {
          summary.worstMph = verdict.worstMph;
        }
        summary.contaminatedSpans.push({
          startTs: verdict.startTs,
          endTs: verdict.endTs,
          points: verdict.points,
        });
        break;
    }
  }
  return summary;
}
