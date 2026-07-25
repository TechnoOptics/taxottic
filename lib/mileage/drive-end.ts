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

export type DriveEndReason = "walked_away" | "stationary_timeout";

export type DriveEndSignals = {
  /** Has this session actually been driving (ever exceeded driving speed)?
   *  We never close a "drive" that never moved. */
  hasDriven: boolean;
  /** ms since the vehicle last moved above STATIONARY_SPEED_MPS. 0 while
   *  still moving. */
  stationaryMs: number;
  /** Steps counted since the vehicle went stationary. */
  stepsSinceStationary: number;
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
  // Parked but no walking detected (sat in car / phone left behind).
  if (s.stationaryMs >= STATIONARY_CLOSE_MS) {
    return { close: true, reason: "stationary_timeout" };
  }
  return { close: false, reason: null };
}
