// Foreground-only tracker detection (pure).
//
// The third way tracking silently loses drives, after "silent" (no uploads
// at all) and "parked" (uploads but the phone never moves).
//
// A healthy background tracker reports overwhelmingly from the BACKGROUND:
// the whole point is that it runs with the app closed. Grace's iPhone logged
// 284 background heartbeats across two days on 1.3.6. After 1.3.7 it logged
// exactly one, then only foreground heartbeats, in bursts of 2 to 5 GPS
// points at the moments she happened to open the app. The tracker was only
// ever arming while she was looking at the screen, so every drive taken with
// the app closed, which is every real drive, was lost.
//
// Why the existing alarms cannot see this:
//
//   * The SILENT sweep triggers on a gap in uploads. A foreground-only
//     device is not silent. Each time the user opens the app it uploads a
//     handful of points, and that upload CLEARS the stall episode. The
//     failure actively hides from silence detection, which is why this ran
//     for four days while the alerting we had reported nothing wrong.
//   * The PARKED sweep triggers on uploads that never move. These points do
//     move; there are just far too few of them.
//
// The tell is a ratio, not a count, and it is available server-side on every
// build because it comes from heartbeats rather than from the native plugin
// (whose probe still times out on both devices, see device_status_source =
// 'none'). That independence is the point: this must work on a device whose
// native telemetry is broken, because that is exactly the device in trouble.
//
// FALSE POSITIVES ARE THE HARD PART. Android is not iOS. Abel's Android
// device legitimately reports 0 to 2 background heartbeats a day against 4
// to 9 foreground ones, because Android's foreground service and heartbeat
// cadence behave nothing like iOS's. A rule of "no background heartbeats
// means broken" would page him every single day and be ignored inside a
// week, and an alarm that is ignored is worse than no alarm.
//
// So the detector is SELF-CALIBRATING and never compares platforms to each
// other. It only ever compares a device to ITSELF: it fires when a device
// that has PROVEN it can report from the background stops doing so while
// still being demonstrably alive in the foreground. A device that never had
// a strong background baseline is never judged, so Android devices and
// brand-new installs are silently excluded rather than special-cased by
// platform string.

/** How far back "recently" reaches when counting heartbeats.
 *
 *  48h, not 24h, and the difference is the whole detector. Heartbeats only
 *  arrive when the app is actually running, so a phone whose background
 *  tracking is dead reports a handful of times a DAY, not a minute. Checked
 *  against production before shipping: over 24h the affected device showed
 *  285 baseline background heartbeats, 0 recent background ones, and just
 *  ONE foreground heartbeat, which fails MIN_RECENT_FOREGROUND below and
 *  would have returned "silent" on the exact incident this exists to catch.
 *  Over 48h the same device shows 3 foreground heartbeats and fires
 *  correctly. Sizing this from the data rather than from a round number is
 *  the only reason it works. */
export const RECENT_WINDOW_MS = 48 * 60 * 60_000; // 48h

/** The reference window that establishes what this device is capable of.
 *  Deliberately much longer than the recent window so a device has to have
 *  a real track record before it can be judged against it. */
export const BASELINE_WINDOW_MS = 14 * 24 * 60 * 60_000; // 14d

/** Background heartbeats required in the baseline window before we are
 *  willing to call a device "capable of background tracking".
 *
 *  Calibrated against real data: Grace's iPhone cleared this by more than
 *  an order of magnitude (284 in two days) while Abel's Android device
 *  peaked at 2 in a day and never approaches it. That gap is what keeps
 *  Android off this alarm without naming Android anywhere. */
export const MIN_BASELINE_BACKGROUND = 20;

/** Foreground heartbeats required in the recent window before we call the
 *  device alive. Without this, a phone that is simply switched off looks
 *  identical to a foreground-only one, and this alarm would steal the
 *  silent sweep's job and double-notify for the same underlying problem. */
export const MIN_RECENT_FOREGROUND = 2;

/** A foreground-only tracker is a standing condition rather than an event,
 *  and the fix (reopen the app, take an update) is not instant, so remind
 *  daily rather than every tick. */
export const RENOTIFY_MS = 24 * 60 * 60_000; // 24h

export type ForegroundOnlyDecision = "notify" | "silent" | "clear";

export function evaluateForegroundOnlyTracker(args: {
  /** Background heartbeats (probe_foreground = false) in BASELINE_WINDOW_MS. */
  baselineBackground: number;
  /** Background heartbeats in RECENT_WINDOW_MS. */
  recentBackground: number;
  /** Foreground heartbeats (probe_foreground = true) in RECENT_WINDOW_MS. */
  recentForeground: number;
  /** Now (ms epoch), passed in so this stays pure and testable. */
  nowMs: number;
  /** When we last notified for the CURRENT episode, null if never. */
  lastNotifiedMs: number | null;
}): ForegroundOnlyDecision {
  const {
    baselineBackground,
    recentBackground,
    recentForeground,
    nowMs,
    lastNotifiedMs,
  } = args;

  // Background tracking is working. This is the ordinary healthy path and it
  // is checked FIRST so a recovered device closes its episode immediately,
  // even if it would not have qualified for judgement in the first place.
  if (recentBackground > 0) return "clear";

  // Never proven capable of background reporting, so there is no baseline to
  // have regressed from. Covers Android, fresh installs, and anyone who has
  // barely used the app. Not "clear": there is no episode to close, and
  // returning clear here would delete an open episode belonging to a device
  // whose baseline merely aged out of the window.
  if (baselineBackground < MIN_BASELINE_BACKGROUND) return "silent";

  // Capable, and no background reports, but nothing in the foreground either.
  // The phone is off, offline, or the app was uninstalled. That is silence,
  // and the silent sweep owns it.
  if (recentForeground < MIN_RECENT_FOREGROUND) return "silent";

  // Capable of background reporting, alive in the foreground, and reporting
  // nothing from the background. That is the signature.
  if (lastNotifiedMs == null || nowMs - lastNotifiedMs >= RENOTIFY_MS) {
    return "notify";
  }
  return "silent";
}
