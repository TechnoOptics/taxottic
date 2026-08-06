// Tracker-stall detection (pure).
//
// A healthy tracker uploads points continuously, even parked (the
// stationary heartbeat cadence is minutes, not hours). So a driver who
// HAS been uploading recently and then goes silent for hours has a dead
// tracker: iOS reverted Location "Always" → "While Using" (the observed
// repeat failure), the toggle got turned off, or the OS killed the app.
// None of those are visible server-side except as silence — which makes
// silence the trigger for the push escalation, reaching the driver even
// though the in-app "Always" banner can't (the app isn't open).
//
// Episode semantics: notify once when the silence crosses the
// threshold, re-notify at most every RENOTIFY_MS while it persists, and
// clear the episode as soon as points flow again so the NEXT stall
// notifies fresh.

/** Silence longer than this = the tracker is considered stalled.
 *  Generous vs the minutes-scale heartbeat so a phone that is merely
 *  offline for a stretch (flight, dead zone) doesn't false-alarm.
 *
 *  Lowered from 3h to 90m on 2026-08-06. The 3h floor was chosen to
 *  tolerate a flight or a dead zone, but the cost of waiting is a
 *  whole morning of driving that no longer exists: capture is the only
 *  record, so a mile missed is a mile gone, while a false alarm costs
 *  one dismissed notification. Those are not symmetric.
 *
 *  90m still clears the common false-alarm cases: a domestic flight
 *  segment, a tunnel, a rural stretch, or a phone left on the charger
 *  through lunch, because the device BUFFERS while offline and the
 *  flush backdates nothing (detection reads created_at, the upload
 *  time, so a reconnect inside the window closes the episode before it
 *  ever notifies). */
export const STALL_AFTER_MS = 90 * 60_000; // 90m

/** While a stall persists, remind at most this often. */
export const RENOTIFY_MS = 24 * 60 * 60_000; // 24h

/** Only drivers with an upload inside this window are watched at all —
 *  someone who never tracks (or stopped weeks ago and knows it) should
 *  not get nagged. */
export const WATCH_WINDOW_MS = 7 * 24 * 60 * 60_000; // 7 days

export type StallDecision = "notify" | "silent" | "clear";

/**
 * What `escalated_at` should be after this tick.
 *
 * The escalation notify carries a per-driver-per-day dedupe key, so only
 * the FIRST tick of an episode gets `delivered > 0`; every tick after it
 * is deduped and reports zero. Writing that zero straight into the row
 * erases the timestamp of an escalation that really happened — the same
 * defect as stamping notified_at for a delivery that never happened,
 * just inverted, and it lands on the one field that proves a manager was
 * warned.
 *
 * So: a fresh escalation always wins, otherwise keep whatever the
 * episode already recorded. The episode is cleared wholesale when points
 * flow again, which is what resets this for the next stall.
 */
export function nextEscalatedAt(
  existing: string | null | undefined,
  fresh: string | null,
): string | null {
  return fresh ?? existing ?? null;
}

export function evaluateTrackerStall(args: {
  /** Newest mileage_points_raw.created_at for the driver (ms epoch). */
  lastUploadMs: number;
  /** Now (ms epoch) — passed in so this stays pure/testable. */
  nowMs: number;
  /** When we last notified for the CURRENT episode, null if never. */
  lastNotifiedMs: number | null;
}): StallDecision {
  const { lastUploadMs, nowMs, lastNotifiedMs } = args;
  const silence = nowMs - lastUploadMs;
  if (silence < STALL_AFTER_MS) {
    // Uploading fine — end any open episode so the next stall re-alerts.
    return "clear";
  }
  if (silence > WATCH_WINDOW_MS) {
    // Long-dead tracker: outside the watch window, stop nagging.
    return "silent";
  }
  if (lastNotifiedMs == null || nowMs - lastNotifiedMs >= RENOTIFY_MS) {
    return "notify";
  }
  return "silent";
}
