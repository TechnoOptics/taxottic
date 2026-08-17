/**
 * JS side of the learned-place geofence mesh (Android).
 *
 * The mesh is the resurrection net for the confirmed production bug:
 * the phone sits at home overnight, the OS kills the app process (or
 * Samsung's sleeping-apps state restricts it), nothing re-arms the
 * foreground service, and the first drive of the day is lost while
 * every drive after the user reopens the app is captured perfectly.
 *
 * A platform geofence is delivered to a process the OS starts for the
 * purpose, so it fires when nothing of ours is running. Driving out of
 * a ~150 m radius around home therefore restarts capture, where
 * significant-location-change would need roughly 500 m of travel first.
 *
 * Everything that matters happens in native code
 * (android/app/src/main/java/com/taxottic/app/TaxotticGeofence*.java).
 * This file only pushes the server's learned place list down, drains
 * what the native capture recorded while the WebView was dead, and
 * turns the native health state into something the driver can act on.
 */

import { registerPlugin } from "@capacitor/core";
import { ensureHeartbeatTimer } from "./heartbeat-timer";
import { UPLOAD_BATCH_MAX } from "./flush-policy";
import { postAccepted, postJson } from "./post-json";
import type { PostedFix } from "./drain-coverage";
export type GeofenceArmState =
  | "armed"
  | "disarmed_no_places"
  | "disarmed_no_background_permission"
  | "disarmed_registration_failed";

export type GeofenceCaptureState =
  | "capturing"
  | "blind_no_fix"
  | "ended"
  | "location_services_off";

export type GeofenceState = {
  armState: GeofenceArmState;
  registeredCount: number;
  registeredAtMs: number;
  registrationError: string | null;
  placeCount: number;
  maxPlaces: number;
  backgroundLocation: boolean;
  captureRunning: boolean;
  bufferOverflow: boolean;
  bufferedFixes: number;
  lastEvent: {
    placeId: string | null;
    transition: "enter" | "exit";
    outcome: string;
    detail: string;
    atMs: number;
  } | null;
  lastCapture: {
    state: GeofenceCaptureState;
    detail: string;
    fixCount: number;
    startedAtMs: number;
    updatedAtMs: number;
  } | null;
};

type NativeFix = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  time: number;
};

type GeofencePlugin = {
  syncPlaces(options: {
    places: Array<{
      id: string;
      latitude: number;
      longitude: number;
      radius: number;
      label: string;
    }>;
  }): Promise<{
    accepted: number;
    submitted: number;
    maxPlaces: number;
    armState: GeofenceArmState;
    backgroundLocation: boolean;
  }>;
  getState(): Promise<GeofenceState>;
  readBuffer(): Promise<{ fixes: NativeFix[]; count: number }>;
  consumeBuffer(options: { count: number }): Promise<{ remaining: number }>;
  stopCapture(): Promise<void>;
  /**
   * Optional: absent on any binary built before the drive-protection
   * change, and a remote-URL WebView routinely runs new JS against an old
   * native shell. Call sites must feature-detect, never assume.
   */
  startCapture?(): Promise<{ started: boolean; reason: string }>;
  clearPlaces(): Promise<{ armState: GeofenceArmState }>;
};

/**
 * Same reasoning as lib/mileage/device-status.ts: deliberately NOT
 * gated on isPluginAvailable(). This app loads a remote URL, so the
 * bridge's plugin registry is not reliably populated in the page's JS
 * context at the moment we ask. registerPlugin is safe regardless; a
 * missing native side simply makes the call reject, which every caller
 * here handles.
 */
/**
 * Returns the plugin BOXED. Capacitor's registerPlugin proxy has a callable
 * `.then` (its get trap special-cases only $$typeof, toJSON, addListener and
 * removeListener), so it is a thenable, and returning it bare from an async
 * function makes the runtime call proxy.then(...) — a native method that does
 * not exist. The promise never settles and every caller here waits forever,
 * which is why geofence_arm_state and geofence_count have always been NULL.
 * See lib/mileage/plugin-box.test.ts.
 */
async function guard(): Promise<{ p: GeofencePlugin } | null> {
  try {
    if (typeof window === "undefined") return null;
    const w = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    if (w.Capacitor?.isNativePlatform?.() !== true) return null;
    // registerPlugin is imported STATICALLY at the top of this file.
    //
    // This was `await import("@capacitor/core")`, and that is why the
    // geofence mesh never armed. Measured on the owner's Galaxy Z Fold5
    // running 1.3.5: geofence_arm_state NULL, geofence_count NULL,
    // mileage_learned_places 0, on a device that was capturing drives
    // normally. The identical dynamic import in device-status.ts was
    // proven to hang, reporting device_probe_stage = "bridge" on every
    // sampled heartbeat with the app in the foreground and timers on
    // schedule. A chunk fetch that never resolves leaves the promise
    // pending forever with no rejection for the catch below to see, so
    // every caller of guard() here silently waits and the mesh is never
    // registered.
    // BOXED, never bare. See the doc comment above.
    return { p: registerPlugin<GeofencePlugin>("TaxotticGeofence") };
  } catch {
    return null;
  }
}

/** Native health, or null when there is no native side to ask. */
export async function getGeofenceState(): Promise<GeofenceState | null> {
  const plugin = (await guard())?.p ?? null;
  if (!plugin) return null;
  try {
    return await plugin.getState();
  } catch {
    return null;
  }
}

/**
 * Fetch the server's learned places and register them as geofences.
 *
 * Called on every resume rather than once, because a permission change,
 * a reinstall, or Play services clearing its geofence table all leave
 * the flag set with nothing actually registered, and none of those is
 * observable from here.
 */
export async function syncLearnedPlaces(companyId: string): Promise<{
  synced: number;
  armState: GeofenceArmState | null;
}> {
  const plugin = (await guard())?.p ?? null;
  if (!plugin || !companyId) return { synced: 0, armState: null };
  let places: Array<{
    id: string;
    label: string;
    latitude: number;
    longitude: number;
    radius: number;
  }> = [];
  try {
    const res = await fetch(
      `/api/mileage/places/learned?companyId=${encodeURIComponent(companyId)}`,
      { credentials: "include" },
    );
    if (!res.ok) return { synced: 0, armState: null };
    const body = (await res.json()) as { places?: typeof places };
    places = body.places ?? [];
  } catch {
    return { synced: 0, armState: null };
  }
  if (places.length === 0) return { synced: 0, armState: null };
  try {
    const result = await plugin.syncPlaces({
      places: places.map((p) => ({
        id: p.id,
        latitude: p.latitude,
        longitude: p.longitude,
        radius: p.radius,
        label: p.label,
      })),
    });
    return { synced: result.accepted, armState: result.armState };
  } catch {
    return { synced: 0, armState: null };
  }
}

/**
 * Upload fixes the native resurrection service captured while this page
 * did not exist, then drop only what the server accepted.
 *
 * Deliberately read-then-confirm-then-consume rather than a single
 * drain call: an upload that fails must leave the drive on disk. Late
 * points are fine, the finalizer reconciles over a 45-day window, so a
 * morning commute uploaded at lunchtime still becomes a correct trip.
 *
 * Called from lib/mileage/native-drain.ts, which is what stopped this
 * being a once-per-app-launch event. Two consequences follow from that
 * and both are handled below rather than assumed away:
 *
 *  - The batch is CAPPED at UPLOAD_BATCH_MAX, and only what was posted
 *    is consumed. Uncapped, this path produced single inserts of 3764
 *    points, and a 179 KB body is already known to break uploads on a
 *    real handset.
 *  - The POST declares `backlog: true`. A drain taken minutes after a
 *    drive ends lands in the clock-skew shift's 2 to 30 minute band,
 *    which no production batch had ever hit before, and being shifted
 *    there would make a retry write a second copy of the drive under a
 *    different captured_at. See ./clock-skew.
 */
export async function drainGeofenceBuffer(
  companyId: string,
  onPosted?: (posted: PostedFix[]) => void,
): Promise<number> {
  const plugin = (await guard())?.p ?? null;
  if (!plugin || !companyId) return 0;
  let fixes: NativeFix[] = [];
  try {
    const read = await plugin.readBuffer();
    fixes = read?.fixes ?? [];
  } catch {
    return 0;
  }
  if (fixes.length === 0) return 0;
  // Head of the queue only. The tail keeps its place on disk and the
  // next drain takes it, exactly as the JS flush loop treats its buffer.
  fixes = fixes.slice(0, UPLOAD_BATCH_MAX);

  const points = fixes
    .filter(
      (f) =>
        Number.isFinite(f.latitude) &&
        Number.isFinite(f.longitude) &&
        Number.isFinite(f.time),
    )
    .map((f) => ({
      lat: f.latitude,
      lng: f.longitude,
      ts: f.time,
      speedMps: Number.isFinite(f.speed as number) ? (f.speed as number) : null,
      accuracyM: Number.isFinite(f.accuracy as number) ? (f.accuracy as number) : null,
    }));
  if (points.length === 0) return 0;

  try {
    // Points are reaching the server through THIS path, so health must be
    // reported alongside them. See ensureHeartbeatTimer: arming from the
    // tracker's own loop alone left a device sending GPS for 27 hours with
    // zero heartbeats, because this is the path it was actually using.
    ensureHeartbeatTimer();
    const res = await postJson("/api/mileage/ingest", {
      companyId,
      points,
      sessionEnded: true,
      backlog: true,
    });
    if (!postAccepted(res)) return 0;
  } catch {
    return 0;
  }

  // Hand the CONFIRMED batch to the caller, which is what lets the
  // sibling native-buffer drain recognise its own copy of these fixes
  // instead of storing them a second time under a different captured_at.
  // Deliberately after the post rather than inside its try: a batch that
  // was refused covers nothing. Deliberately before the consume too, so
  // a consume that throws cannot turn into a second upload of a stream
  // that is already on the server. See ./drain-coverage.
  onPosted?.(points);

  try {
    // Consume exactly what we POSTED. Anything the service appended while
    // the upload was in flight, and anything the cap declined to take,
    // keeps its place at the tail.
    await plugin.consumeBuffer({ count: fixes.length });
  } catch {
    // The points are already on the server and ingest is idempotent on
    // (driver, company, captured_at), so a failed consume costs one
    // duplicate upload, never a lost drive.
  }
  return points.length;
}

/**
 * Hold the Android process at foreground-service importance for the
 * duration of a drive this WebView is already watching.
 *
 * Idempotent and cheap to call on every driving fix: the service returns
 * START_STICKY without restarting its GPS stream when a session is live.
 *
 * Returns whether the process is actually protected, which is not the same
 * as whether we asked. Android 12+ refuses a background foreground-service
 * start unless the app is battery-optimisation allowlisted or acting on an
 * exemption, and that refusal is worth recording rather than assuming away:
 * a driver whose start is refused is tracked exactly as badly as before,
 * and the heartbeat should be able to say so.
 */
export async function startGeofenceCapture(): Promise<boolean> {
  const plugin = (await guard())?.p ?? null;
  if (!plugin?.startCapture) return false;
  try {
    const res = await plugin.startCapture();
    return res?.started === true;
  } catch {
    return false;
  }
}

/**
 * Tell a running capture to stand down because THE DRIVE IS OVER.
 *
 * Deliberately not called on app launch any more. It used to be, on the
 * reasoning that "two location foreground services at once is double the
 * battery for one stream of points" — but the WebView watcher is not a
 * foreground service, so what that actually did was drop the process from
 * protected to CACHED at the exact moment a resurrected drive was starting.
 * Android then reaped it under memory pressure: four LOW_MEMORY kills at
 * importance 400 in three days, one of which opened a 17.5 hour hole with
 * no location data at all across a working day.
 */
export async function stopGeofenceCapture(): Promise<void> {
  const plugin = (await guard())?.p ?? null;
  if (!plugin) return;
  try {
    await plugin.stopCapture();
  } catch {
    /* nothing running is the common case, not an error */
  }
}

export type GeofenceHealth = {
  /** ok: the net is armed and nothing has failed. */
  status: "ok" | "unavailable" | "degraded" | "broken";
  /** One sentence, written for a driver, not for a log. */
  message: string;
  /** Non-null when there is a settings screen worth opening. */
  action: "background_location" | "location_services" | "open_app" | null;
};

/**
 * Turn native state into something the driver sees.
 *
 * This function exists because of how the original bug hid: the
 * tracking notification kept saying healthy while every fix was being
 * discarded, so a 21-hour blackout looked identical to a quiet day.
 * Every failure below is a state a user can be shown and can act on.
 * There is deliberately no path that reports success without evidence
 * of success.
 */
export function describeGeofenceHealth(
  state: GeofenceState | null,
): GeofenceHealth {
  if (!state) {
    return {
      status: "unavailable",
      message: "Automatic restart is not available on this device.",
      action: null,
    };
  }

  // A capture that ran and never saw a fix is the important one: the
  // permission check said granted, the service started, the
  // notification was up, and location was still not usable. Report it
  // ahead of everything else.
  if (state.lastCapture?.state === "blind_no_fix") {
    return {
      status: "broken",
      message:
        "Taxottic started recording a drive but received no location. Set Location to \"Allow all the time\" so drives that start while the app is closed are recorded.",
      action: "background_location",
    };
  }
  if (state.lastCapture?.state === "location_services_off") {
    return {
      status: "broken",
      message:
        "Taxottic tried to record a drive but location services were off, so the drive was not recorded.",
      action: "location_services",
    };
  }
  if (state.bufferOverflow) {
    return {
      status: "degraded",
      message:
        "Recorded drives are waiting to upload and local storage is full. Open Taxottic on a connection to send them.",
      action: "open_app",
    };
  }

  switch (state.armState) {
    case "disarmed_no_background_permission":
      return {
        status: "broken",
        message:
          "Drives that start while Taxottic is closed will be missed. Set Location to \"Allow all the time\".",
        action: "background_location",
      };
    case "disarmed_registration_failed":
      return {
        status: "broken",
        message:
          "Taxottic could not set up automatic restart for your saved places, so a drive that starts while the app is closed may be missed.",
        action: "location_services",
      };
    case "disarmed_no_places":
      return {
        status: "degraded",
        message:
          "Taxottic is still learning where you usually park. Automatic restart begins once it has enough drives.",
        action: null,
      };
    case "armed":
    default:
      if (state.registeredCount === 0) {
        return {
          status: "degraded",
          message:
            "Taxottic is still learning where you usually park. Automatic restart begins once it has enough drives.",
          action: null,
        };
      }
      return {
        status: "ok",
        message: `Taxottic will restart tracking automatically when you leave any of your ${state.registeredCount} usual places.`,
        action: null,
      };
  }
}
