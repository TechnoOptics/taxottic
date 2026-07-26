// Drive-end detection (pure).
//
// Today a drive only closes after the server sees 5 minutes of GPS
// stillness — a deliberately conservative timer that exists ONLY so a
// red light or drive-through doesn't fragment one drive into five. Motion
// signals let us do better: the moment the driver actually WALKS AWAY from
// the car (a burst of steps after the vehicle went still), the drive is
// unambiguously over and we can close it in ~30 s instead of ~5 min.
//
// The user's own framing, kept as the two-signal design:
//   "detect once a user starts to walk and takes more than a number of
//    steps, OR has been stationary for the suggested time" — belt and
//    suspenders, so a drive closes correctly whether they walk away, sit
//    in the car, or leave the phone behind.
//
// Pure + unit-tested. The native motion layer feeds live signals; the
// tracker acts on the decision by firing a `sessionEnded` flush (which
// force-closes the trip server-side).

/** Steps taken AFTER the vehicle went stationary that mean "walked away
 *  from the car" (a short walk into a building), not driver fidgeting. */
export const STEP_CLOSE_THRESHOLD = 18;

/** Fallback: close a stationary drive after this long even with no steps
 *  (phone left in the car, driver sitting). Matches the server's own
 *  parked-dwell floor so the two never disagree, just a hair longer to
 *  stay conservative when steps are unavailable. */
// Longer than the server's 10-min in-stream dwell ON PURPOSE: this
// fallback fires a forceClose, so at 6 min it was severing drives at
// drawbridges/train crossings (no steps at a stop, so only the timer
// gates it). Walk-away (steps) stays fast; the timer is the slow path.
export const STATIONARY_CLOSE_MS = 12 * 60_000;

/** A driving-like speed. Below this the vehicle is treated as stationary
 *  for the purpose of drive-end (m/s; ~3.4 mph). */
export const STATIONARY_SPEED_MPS = 1.5;

export type DriveEndReason =
  | "walked_away"
  | "gps_walk"
  | "stationary_timeout";

// ── GPS walk-away (no permission required) ─────────────────────────
// Android 1.3.0 shipped WITHOUT the step counter (Google Play rejects
// ACTIVITY_RECOGNITION under a truthful "no health features" answer),
// so Android lost the fast walk-away signal entirely. But walking is
// unmistakable in the GPS stream we already collect: sustained fixes in
// the walking-speed band drifting away from where the car stopped. No
// sensor, no permission, works on every platform, and deploys as web
// code. Steps (iOS) stay as the fastest signal; this is the second.

/** Speed band that reads as walking, not driving and not GPS jitter
 *  (m/s). Lower bound keeps a stationary phone's noise out; upper stays
 *  below slow-rolling traffic. */
export const WALK_SPEED_MIN_MPS = 0.4;
export const WALK_SPEED_MAX_MPS = 2.5;

/** Distance from the park point that means "left the car", not pacing
 *  next to it (meters). With a ~25 m distance filter this is 2-3 fixes,
 *  roughly 30-60 s of walking. */
export const WALK_DISPLACEMENT_M = 45;

/** Fixes inside the walking band required alongside the displacement,
 *  so one bad fix can't close a drive. */
export const WALK_FIX_COUNT = 3;

// ── Anti-traffic guards (2026-07-26) ────────────────────────────────
// Field failure: highway stop-and-go traffic creeps at EXACTLY walking
// pace, so the original detector closed two real drives mid-motion
// (156 highway-speed fixes arrived within 3 min of one "walk-away").
// Two physical truths a car in traffic cannot fake:
//   1. A real park begins with a HARD stop. Cars in a jam keep inching;
//      a parked car sits genuinely still. The walk detector only ARMS
//      after WALK_ARM_STOP_MS continuously under HARD_STOP_SPEED_MPS.
//      Any creep resets the clock; any driving-speed fix resets it all.
//   2. A walker LEAVES THE ROAD'S AXIS. Jam creep continues along the
//      pre-stop driving heading; someone walking into a building
//      diverges from it. The park→walker vector must differ from the
//      last driving heading by WALK_OFF_AXIS_MIN_DEG — or, when no
//      heading is known, the displacement must reach the much larger
//      WALK_NO_BEARING_DISPLACEMENT_M before we trust it.
// Cost of the guards: someone who parks and walks along the sidewalk in
// the exact direction they were driving falls back to the stationary
// timer instead of the fast close. Correct-but-slower beats
// fast-but-wrong here — a mid-drive close splits an IRS record.

/** Below this the vehicle is genuinely stopped, not creeping (m/s). */
export const HARD_STOP_SPEED_MPS = 0.7;

/** Continuous hard-stop time required before walk detection arms. Long
 *  lights arm too (90s+ reds exist) — the off-axis test and the
 *  any-driving-fix reset still protect them. */
export const WALK_ARM_STOP_MS = 45_000;

/** Minimum angle between the last driving heading and the park→walker
 *  vector for the movement to read as "left the road" (degrees). */
export const WALK_OFF_AXIS_MIN_DEG = 45;

/** With no usable driving heading, require this much displacement
 *  instead — far beyond one jam creep between fixes (meters). */
export const WALK_NO_BEARING_DISPLACEMENT_M = 120;

export type DriveEndSignals = {
  /** Has this session actually been driving (ever exceeded driving speed)?
   *  We never close a "drive" that never moved. */
  hasDriven: boolean;
  /** ms since the vehicle last moved above STATIONARY_SPEED_MPS. 0 while
   *  still moving. */
  stationaryMs: number;
  /** Steps counted since the vehicle went stationary. */
  stepsSinceStationary: number;
  /** GPS walk signal: meters moved from the park point since going
   *  stationary, and how many fixes landed in the walking-speed band.
   *  Zero/absent when no fixes have arrived (phone still in the car:
   *  the distance filter emits nothing from a parked phone). */
  walkDisplacementM?: number;
  walkingFixCount?: number;
  /** True only after a continuous hard stop of WALK_ARM_STOP_MS — the
   *  precondition traffic creep can never satisfy. */
  walkArmed?: boolean;
  /** Angle (deg, 0-180) between the last driving heading and the
   *  park→current vector; null when no heading is known. */
  walkBearingDeltaDeg?: number | null;
};

export type DriveEndDecision =
  | { close: true; reason: DriveEndReason }
  | { close: false; reason: null };

/**
 * Decide whether an active drive has ended and should be force-closed now.
 */
export function evaluateDriveEnd(s: DriveEndSignals): DriveEndDecision {
  if (!s.hasDriven) return { close: false, reason: null };
  // Still moving → definitely not ended.
  if (s.stationaryMs <= 0) return { close: false, reason: null };
  // Walked away: the fast, unambiguous signal.
  if (s.stepsSinceStationary >= STEP_CLOSE_THRESHOLD) {
    return { close: true, reason: "walked_away" };
  }
  // GPS walk-away: sustained walking-band movement away from the park
  // point. The permission-free equivalent for builds without a step
  // counter (all Android 1.3.0+), and a second witness everywhere else.
  if (
    s.walkArmed === true &&
    (s.walkDisplacementM ?? 0) >= WALK_DISPLACEMENT_M &&
    (s.walkingFixCount ?? 0) >= WALK_FIX_COUNT &&
    (s.walkBearingDeltaDeg == null
      ? (s.walkDisplacementM ?? 0) >= WALK_NO_BEARING_DISPLACEMENT_M
      : s.walkBearingDeltaDeg >= WALK_OFF_AXIS_MIN_DEG)
  ) {
    return { close: true, reason: "gps_walk" };
  }
  // Parked but no walking detected (sat in car / phone left behind).
  if (s.stationaryMs >= STATIONARY_CLOSE_MS) {
    return { close: true, reason: "stationary_timeout" };
  }
  return { close: false, reason: null };
}
