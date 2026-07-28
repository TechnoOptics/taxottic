// Fleet-wide capture-regression detection.
//
// Every mileage incident so far was found by a HUMAN noticing missing
// drives days later: "our devices have not tracked our drives this
// whole week", "it always misses her drives to work". Per-driver alerts
// (stall push, parked push, the manager health card) catch ONE device
// going wrong. None of them catch the class of failure that actually
// hurt us most — a change that quietly degrades capture for everybody
// at once, where no single device looks anomalous relative to the rest.
//
// This compares the fleet against ITS OWN recent past. A deploy that
// breaks ingest, a token change, a schema regression, a bad release:
// all of them show up as today's capture collapsing versus the trailing
// baseline, even though every individual device still "looks fine".
//
// Pure so the thresholds are testable and the alerting stays honest.

export type FleetDay = {
  /** Local calendar day, YYYY-MM-DD. */
  day: string;
  /** Distinct drivers that uploaded any raw point. */
  activeDrivers: number;
  /** Raw points ingested. */
  points: number;
  /** Trips materialised. */
  trips: number;
};

export type FleetVerdict =
  | { status: "ok"; reason: null }
  | { status: "warn" | "critical"; reason: string };

/** Below this share of the baseline, capture has meaningfully regressed. */
export const WARN_RATIO = 0.5;
export const CRITICAL_RATIO = 0.2;

/** Need at least this much history before judging anything. */
export const MIN_BASELINE_DAYS = 3;
/** And a baseline this active, or the comparison is noise. */
export const MIN_BASELINE_POINTS_PER_DAY = 50;

/**
 * Compare the most recent complete day against the median of the days
 * before it.
 *
 * Median, not mean: one huge road-trip day would drag a mean upward and
 * mask a real drop the next day.
 *
 * Deliberately conservative — a false alarm every week trains everyone
 * to ignore it, which is worse than no alarm at all.
 */
export function evaluateFleetCapture(
  today: FleetDay,
  baseline: readonly FleetDay[],
): FleetVerdict {
  if (baseline.length < MIN_BASELINE_DAYS) {
    return { status: "ok", reason: null };
  }
  const medianPoints = median(baseline.map((d) => d.points));
  const medianDrivers = median(baseline.map((d) => d.activeDrivers));
  if (medianPoints < MIN_BASELINE_POINTS_PER_DAY) {
    // Too quiet to judge (new install, holiday week).
    return { status: "ok", reason: null };
  }

  // Total silence with an established fleet is the loudest signal there
  // is: not one device uploaded anything.
  if (today.points === 0 && medianPoints > 0) {
    return {
      status: "critical",
      reason: `No mileage points ingested fleet-wide on ${today.day} (typical day: ${Math.round(medianPoints)}). Capture is fully down.`,
    };
  }

  const pointRatio = today.points / medianPoints;
  const driverRatio =
    medianDrivers > 0 ? today.activeDrivers / medianDrivers : 1;

  // Losing DRIVERS is more alarming than losing points: fewer points can
  // just mean less driving, but a device that stops reporting entirely
  // is the signature of the failures we keep hitting.
  if (driverRatio <= CRITICAL_RATIO) {
    return {
      status: "critical",
      reason: `Only ${today.activeDrivers} of a typical ${Math.round(medianDrivers)} drivers uploaded on ${today.day}. Most devices have stopped reporting.`,
    };
  }
  if (pointRatio <= CRITICAL_RATIO) {
    return {
      status: "critical",
      reason: `Fleet capture at ${Math.round(pointRatio * 100)}% of normal on ${today.day} (${today.points} vs ~${Math.round(medianPoints)} points).`,
    };
  }
  if (driverRatio <= WARN_RATIO || pointRatio <= WARN_RATIO) {
    return {
      status: "warn",
      reason: `Fleet capture down on ${today.day}: ${today.points} points (~${Math.round(pointRatio * 100)}% of normal) from ${today.activeDrivers} of ~${Math.round(medianDrivers)} drivers.`,
    };
  }

  // Points flowing but nothing becoming a trip = the finalizer or
  // segmentation broke. Invisible to every per-device check, because the
  // devices are behaving perfectly.
  if (today.points >= MIN_BASELINE_POINTS_PER_DAY && today.trips === 0) {
    const medianTrips = median(baseline.map((d) => d.trips));
    if (medianTrips >= 1) {
      return {
        status: "critical",
        reason: `${today.points} points ingested on ${today.day} but ZERO trips materialised (typical: ${Math.round(medianTrips)}). Devices are fine; the pipeline is not.`,
      };
    }
  }

  return { status: "ok", reason: null };
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
