// Arming latch (pure).
//
// startMileageTracking arms the native tracker with a STOP-THEN-START
// dance: `await stopBgSafely(bg)` tears down any orphaned service, then
// `bg.start()` builds a fresh subscription with a live callback. The stop
// is not optional, it is what fixes the Android ALREADY_STARTED bug where
// a surviving foreground service keeps an orphaned callback and every fix
// during a drive goes to /dev/null.
//
// But it leaves a window. Between the stop and the start there is an
// `await`, and if the JS context dies there (an iOS WebView suspended
// while backgrounded, an Android process kill, a page reload), the live
// background service has been stopped and nothing restarts it. Tracking is
// off, the UI still says it is on, and the device keeps reporting a
// heartbeat whenever the app is open. That is invisible from the server
// and indistinguishable from a healthy parked phone.
//
// The latch makes it visible: stamp before the stop, clear after the start
// returns. A latch still set on a later run is proof that a previous arm
// was interrupted midway, which means tracking was left DOWN rather than
// merely idle.
//
// This does not by itself restart anything. On iOS nothing can: the OS
// will not run this code until the app is launched or woken. What it buys
// is that the condition is reported instead of guessed at, and that the
// resume path can treat "interrupted" differently from "never started".

/** A latch younger than this is almost certainly an arm still in flight on
 *  another tick, not an interrupted one. The real sequence completes in
 *  milliseconds; this is generous so a slow native bridge on a cold start
 *  is never misread as a failure. */
export const ARM_IN_FLIGHT_GRACE_MS = 30_000; // 30s

/** Older than this and the timestamp says nothing useful: the device has
 *  been through app launches since. Treated as stale-and-ignorable so a
 *  latch left by a long-dead session cannot raise a permanent false
 *  alarm. */
export const ARM_LATCH_MAX_AGE_MS = 7 * 24 * 60 * 60_000; // 7d

/**
 * Was a previous arm interrupted between stop and start?
 *
 * @param latchMs when the interrupted arm began, or null if no latch.
 * @param nowMs   current time.
 */
export function isArmInterrupted(
  latchMs: number | null,
  nowMs: number,
): boolean {
  if (latchMs == null) return false;
  // A latch from the future is a clock change, not evidence. Ignore it
  // rather than reporting an interruption that never happened.
  if (latchMs > nowMs) return false;
  const age = nowMs - latchMs;
  // `<=`, not `<`: at exactly the grace boundary this stays quiet. The
  // boundary is arbitrary either way, so it resolves toward NOT raising an
  // alarm, which is the right bias for a signal whose false positives cost
  // trust in every other alert.
  if (age <= ARM_IN_FLIGHT_GRACE_MS) return false;
  if (age > ARM_LATCH_MAX_AGE_MS) return false;
  return true;
}

/** Parse a latch out of localStorage. Anything unparseable is treated as
 *  absent: a corrupt value must never masquerade as an incident. */
export function parseArmLatch(raw: string | null): number | null {
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}
