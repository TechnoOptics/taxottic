// Drive-lifecycle LOCAL notifications + a "keep going" grace timer.
//
// Runs on-device alongside the background-geolocation tracker (see
// native-tracker.ts, which calls onTrackerPoint() for every GPS fix).
// It maintains a tiny client-side state machine off the live point
// stream — the server still owns the authoritative segmentation; this
// is purely the real-time driver UX:
//
//   • Sustained movement  → "Logging your drive 🚗" notification.
//   • Stopped a few min    → "Trip ended? Keep going?" notification with
//                            a Keep-going action and a 1-minute timer.
//       - Tap "Keep going" OR start driving again → trip continues.
//       - Ignore for 1 min → finalize() fires (the tracker flushes
//         sessionEnded, closing the trip). Tracking itself stays on.
//
// Everything degrades to a clean no-op when @capacitor/local-
// notifications isn't present (web, or a build without the plugin), so
// importing this is always safe.
//
// NOTE: thresholds below are first-pass defaults — tune on-device.

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  DRIVING_SPEED_MPS,
  STATIONARY_RADIUS_M,
  haversineMeters,
} from "./segmentation";

/** Prompt this long after the vehicle first settles. Above a normal
 *  traffic stop so red lights / short jams don't prompt; a real arrival
 *  does. Resuming movement before this cancels everything. */
const PROMPT_AFTER_STOPPED_MS = 3 * 60 * 1000;
/** The user-chosen grace window: after the prompt, auto-finalize if the
 *  driver neither taps "Keep going" nor starts moving again. */
const GRACE_MS = 60 * 1000;

const N_DRIVE_START = 8801;
const N_TRIP_END = 8802;
const ACTION_TYPE = "TAXOTTIC_TRIP_END";
const ACTION_KEEP_GOING = "keep_going";

type Pt = { lat: number; lng: number; ts: number; speedMps?: number };

let ln: any = null; // @capacitor/local-notifications plugin (or null)
let available = false;
let initialized = false;
let finalizeCb: (() => void) | null = null;

let driveActive = false;
let lastPt: Pt | null = null;
let anchor: Pt | null = null; // first settle point of the current stop
let prompted = false;
let endTimer: ReturnType<typeof setTimeout> | null = null;

async function loadLN(): Promise<any> {
  if (ln) return ln;
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return null;
    if (!Capacitor.isPluginAvailable("LocalNotifications")) return null;
    const mod = await import("@capacitor/local-notifications");
    ln = (mod as any).LocalNotifications ?? null;
    available = !!ln;
    return ln;
  } catch {
    return null;
  }
}

/** Call once when tracking starts. Wires permission + the Keep-going
 *  action + its listener, and stores the finalize callback the tracker
 *  hands us (a flush with sessionEnded:true). Safe to call repeatedly. */
export async function initTripNotifications(
  finalize: () => void,
): Promise<void> {
  finalizeCb = finalize;
  if (initialized) return;
  const p = await loadLN();
  if (!p) return;
  initialized = true;
  try {
    await p.requestPermissions();
    await p.registerActionTypes({
      types: [
        {
          id: ACTION_TYPE,
          actions: [{ id: ACTION_KEEP_GOING, title: "Keep going" }],
        },
      ],
    });
    await p.addListener(
      "localNotificationActionPerformed",
      (event: any) => {
        if (event?.actionId === ACTION_KEEP_GOING) keepGoing();
      },
    );
  } catch {
    /* permission denied / plugin quirk — notifications just won't show */
  }
}

function clearEndTimer() {
  if (endTimer) {
    clearTimeout(endTimer);
    endTimer = null;
  }
}

async function cancelNotif(id: number) {
  const p = await loadLN();
  if (!p) return;
  try {
    await p.cancel({ notifications: [{ id }] });
  } catch {
    /* nothing scheduled — fine */
  }
}

async function show(
  id: number,
  title: string,
  body: string,
  withAction: boolean,
) {
  const p = await loadLN();
  if (!p) return;
  try {
    await p.schedule({
      notifications: [
        {
          id,
          title,
          body,
          ...(withAction ? { actionTypeId: ACTION_TYPE } : {}),
        },
      ],
    });
  } catch {
    /* no permission / quirk — silent */
  }
}

/** Driver tapped "Keep going" (or movement resumed): cancel the pending
 *  finalize and dismiss the prompt, but keep the drive active. Reset the
 *  settle clock so it doesn't immediately re-prompt. */
function keepGoing() {
  clearEndTimer();
  prompted = false;
  anchor = null;
  void cancelNotif(N_TRIP_END);
}

function speedOf(prev: Pt, cur: Pt): number {
  if (typeof cur.speedMps === "number" && cur.speedMps > 0) return cur.speedMps;
  const dt = (cur.ts - prev.ts) / 1000;
  if (dt <= 0) return 0;
  return haversineMeters(prev, cur) / dt;
}

/** Feed every GPS fix here (from the tracker's watcher callback). */
export function onTrackerPoint(pt: Pt): void {
  const prev = lastPt;
  lastPt = pt;
  if (!prev) return; // need two points to judge movement

  const moving = speedOf(prev, pt) >= DRIVING_SPEED_MPS;

  if (moving) {
    // Resumed/continued driving — auto "keep going".
    if (endTimer || prompted) keepGoing();
    anchor = null;
    if (!driveActive) {
      driveActive = true;
      void show(
        N_DRIVE_START,
        "Taxottic mileage",
        "Logging your drive 🚗",
        false,
      );
    }
    return;
  }

  // Stationary, mid-drive: run the settle clock.
  if (!driveActive) return;
  if (!anchor || haversineMeters(anchor, pt) > STATIONARY_RADIUS_M) {
    anchor = pt; // moved to a new spot — restart the stop clock
    return;
  }
  if (!prompted && pt.ts - anchor.ts >= PROMPT_AFTER_STOPPED_MS) {
    prompted = true;
    void show(
      N_TRIP_END,
      "Trip ended?",
      "Looks like you've arrived. Tap “Keep going” to continue — otherwise this drive is logged in 1 minute.",
      true,
    );
    clearEndTimer();
    endTimer = setTimeout(() => {
      endTimer = null;
      // Window elapsed with no Keep-going and no movement → finalize.
      driveActive = false;
      prompted = false;
      anchor = null;
      void cancelNotif(N_TRIP_END);
      void cancelNotif(N_DRIVE_START);
      try {
        finalizeCb?.();
      } catch {
        /* finalize threw — tracker still flushes on its own timer */
      }
    }, GRACE_MS);
  }
}

/** Tracking stopped (toggle off / app teardown). Clear timers + notifs
 *  and reset state. */
export function resetTripNotifications(): void {
  clearEndTimer();
  driveActive = false;
  prompted = false;
  anchor = null;
  lastPt = null;
  if (available) {
    void cancelNotif(N_DRIVE_START);
    void cancelNotif(N_TRIP_END);
  }
}
