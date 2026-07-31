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
async function guard(): Promise<GeofencePlugin | null> {
  try {
    if (typeof window === "undefined") return null;
    const w = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    if (w.Capacitor?.isNativePlatform?.() !== true) return null;
    const { registerPlugin } = await import("@capacitor/core");
    return registerPlugin<GeofencePlugin>("TaxotticGeofence");
  } catch {
    return null;
  }
}

/** Native health, or null when there is no native side to ask. */
export async function getGeofenceState(): Promise<GeofenceState | null> {
  const plugin = await guard();
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
  const plugin = await guard();
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
 */
export async function drainGeofenceBuffer(companyId: string): Promise<number> {
  const plugin = await guard();
  if (!plugin || !companyId) return 0;
  let fixes: NativeFix[] = [];
  try {
    const read = await plugin.readBuffer();
    fixes = read?.fixes ?? [];
  } catch {
    return 0;
  }
  if (fixes.length === 0) return 0;

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
    const res = await fetch("/api/mileage/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ companyId, points, sessionEnded: true }),
    });
    if (!res.ok) return 0;
  } catch {
    return 0;
  }

  try {
    // Consume exactly what we read. Anything the service appended while
    // the upload was in flight keeps its place at the tail.
    await plugin.consumeBuffer({ count: fixes.length });
  } catch {
    // The points are already on the server and ingest is idempotent on
    // (driver, company, captured_at), so a failed consume costs one
    // duplicate upload, never a lost drive.
  }
  return points.length;
}

/**
 * Tell a running resurrection capture to stand down because the normal
 * WebView watcher has taken over. Two location foreground services at
 * once is double the battery for one stream of points.
 */
export async function stopGeofenceCapture(): Promise<void> {
  const plugin = await guard();
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
