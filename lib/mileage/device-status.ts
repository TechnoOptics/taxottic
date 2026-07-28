// JS bridge to the TaxotticDeviceStatus native plugin (plan §C).
// Graceful-degradation discipline (same as native-tracker): the plugin
// only exists in app builds that shipped it; on web and older installed
// binaries every entry point no-ops to null.

export type DeviceStatus = {
  platform: string;
  locationAuthorization: "always" | "whenInUse" | "denied" | "notDetermined";
  preciseLocation: boolean;
  /** Android only: OS is battery-optimizing the app (the Samsung
   *  starvation signal). */
  batteryOptimized?: boolean;
  /** Android only, lowercased OEM for wizard branching. */
  manufacturer?: string;
  /** iOS only. */
  lowPowerMode?: boolean;
  /** Walk-away drive-end: step source usable (sensor present + motion
   *  permission not denied). */
  motionPermission?: boolean;
  backgroundRefresh?: boolean;
};

type DeviceStatusPlugin = {
  getStatus(): Promise<DeviceStatus>;
  requestAlwaysUpgrade(): Promise<void>;
  requestBatteryExemption(): Promise<void>;
  openBatterySettings(): Promise<void>;
  queryStepsSince(opts: { fromMs: number }): Promise<{ steps: number; available: boolean }>;
  requestActivityRecognition(): Promise<{ granted: boolean }>;
  /** Deep-links to THIS app's Location permission screen (Android) or
   *  the app's Settings page (iOS) — closer than the generic app-details
   *  page the Capgo plugin's openSettings can reach. */
  openLocationSettings(): Promise<void>;
  enableBackgroundRevival(opts: { companyId: string }): Promise<{ ok: boolean }>;
  disableBackgroundRevival(): Promise<{ ok: boolean }>;
  drainBufferedLocations(): Promise<{
    points: Array<{
      ts: number;
      lat: number;
      lng: number;
      speedMps: number | null;
      accuracyM: number;
    }>;
    companyId: string;
  }>;
  clearBufferedLocations(opts: { upToTs: number }): Promise<{ remaining: number }>;
  addListener(
    event: "authorizationChanged",
    cb: (data: {
      locationAuthorization: DeviceStatus["locationAuthorization"];
      preciseLocation: boolean;
    }) => void,
  ): Promise<{ remove: () => void }>;
};

async function guard(): Promise<DeviceStatusPlugin | null> {
  try {
    const w = window as unknown as {
      Capacitor?: {
        isNativePlatform?: () => boolean;
        isPluginAvailable?: (n: string) => boolean;
      };
    };
    if (w.Capacitor?.isNativePlatform?.() !== true) return null;
    // Deliberately NOT gated on isPluginAvailable().
    //
    // Measured in production: every field sourced from this plugin was
    // NULL on 100% of devices (0/2) across BOTH platforms, while fields
    // from other sources (@capacitor/app version, tracker callback age)
    // populated fine — so the plugin was unreachable from JS even on
    // Android, where it is correctly registered via
    // MainActivity.registerPlugin AND annotated @CapacitorPlugin. The
    // availability probe was the only thing common to both platforms,
    // and it is unreliable here: this app loads a REMOTE url, so the
    // bridge's plugin registry is not guaranteed to be populated in the
    // page's JS context at the moment we ask (and the Android build
    // runs useLegacyBridge).
    //
    // registerPlugin() itself is safe to call regardless — a missing
    // native implementation simply makes the METHOD CALL reject, which
    // every caller already handles. Failing at the call site is strictly
    // better than refusing to try: the old gate turned "maybe present"
    // into a permanent silent no, which is how device truth stayed
    // invisible for weeks while we debugged permissions blind.
    const { registerPlugin } = await import("@capacitor/core");
    return registerPlugin<DeviceStatusPlugin>("TaxotticDeviceStatus");
  } catch {
    return null;
  }
}

export async function getDeviceStatus(): Promise<DeviceStatus | null> {
  const plugin = await guard();
  if (!plugin) return null;
  try {
    return await plugin.getStatus();
  } catch {
    return null;
  }
}

export async function requestAlwaysUpgrade(): Promise<void> {
  const plugin = await guard();
  try {
    await plugin?.requestAlwaysUpgrade();
  } catch {
    /* no-op */
  }
}

/**
 * Deep-link to the app's Location permission screen. Returns true if our
 * TaxotticDeviceStatus plugin handled it (Android: the specific Location
 * permission page; iOS: the app's Settings page). Returns false when the
 * plugin isn't in this binary, so the caller can fall back to the Capgo
 * plugin's coarser openSettings() (which only reaches App info).
 */
export async function openLocationSettingsPrecise(): Promise<boolean> {
  const plugin = await guard();
  if (!plugin) return false;
  try {
    await plugin.openLocationSettings();
    return true;
  } catch {
    return false;
  }
}

/**
 * FIRM auto-exemption (all Android phones + tablets): make sure the OS
 * isn't battery-optimizing us, prompting the native "allow background"
 * dialog automatically when it is — so a driver never has to discover
 * the setup wizard to keep tracking alive. Called on launch + resume
 * (see CapacitorNativeInit) whenever tracking is enabled.
 *
 * Throttled: at most one auto-prompt per ATTEMPT_INTERVAL so we don't
 * nag on every resume, but we DO re-prompt after the interval if the
 * OS silently re-optimized us (Samsung re-enables "sleeping apps" after
 * firmware updates — the exact repeat failure this guards against).
 * A grant clears the throttle immediately so the next revocation
 * re-prompts without delay.
 */
const AUTO_EXEMPT_KEY = "taxottic.mileage.batteryPromptAt";
const ATTEMPT_INTERVAL_MS = 3 * 24 * 60 * 60_000; // 3 days

export async function ensureBatteryExemption(): Promise<void> {
  const plugin = await guard();
  if (!plugin) return;
  let status: DeviceStatus;
  try {
    status = await plugin.getStatus();
  } catch {
    return;
  }
  // Only Android optimizes; batteryOptimized false/undefined = fine.
  if (status.batteryOptimized !== true) {
    try {
      localStorage.removeItem(AUTO_EXEMPT_KEY);
    } catch {
      /* private mode */
    }
    return;
  }
  // Throttle repeated auto-prompts.
  try {
    const last = Number(localStorage.getItem(AUTO_EXEMPT_KEY) ?? 0);
    if (Date.now() - last < ATTEMPT_INTERVAL_MS) return;
    localStorage.setItem(AUTO_EXEMPT_KEY, String(Date.now()));
  } catch {
    /* private mode: still prompt, just no throttle memory */
  }
  try {
    await plugin.requestBatteryExemption();
  } catch {
    /* dialog unavailable; the setup wizard remains the manual path */
  }
}

export async function requestBatteryExemption(): Promise<boolean> {
  const plugin = await guard();
  if (!plugin) return false;
  try {
    await plugin.requestBatteryExemption();
    return true;
  } catch {
    try {
      await plugin.openBatterySettings();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Instant downgrade detection: subscribe to native authorization-change
 * events. Fires the callback with the new level the MOMENT iOS applies
 * a silent Always→While-Using downgrade (or the user changes settings),
 * instead of the server inferring it hours later from GPS silence.
 * Returns an unsubscribe fn (no-op when the plugin is absent).
 */
export async function onAuthorizationChanged(
  cb: (auth: DeviceStatus["locationAuthorization"]) => void,
): Promise<() => void> {
  const plugin = await guard();
  if (!plugin) return () => {};
  try {
    const handle = await plugin.addListener("authorizationChanged", (d) =>
      cb(d.locationAuthorization),
    );
    return () => void handle.remove();
  } catch {
    return () => {};
  }
}

/**
 * Steps taken since `fromMs` (epoch ms), from the device motion
 * coprocessor. Drives the drive-end "walked away" signal
 * (lib/mileage/drive-end.ts). Returns 0 on web / older binaries / when
 * Motion permission is unavailable — the drive-end logic then relies on
 * the stationary-timeout fallback, so a 0 is always safe.
 */
export async function queryStepsSince(fromMs: number): Promise<number> {
  const plugin = await guard();
  if (!plugin) return 0;
  try {
    const r = await plugin.queryStepsSince({ fromMs });
    return typeof r?.steps === "number" ? r.steps : 0;
  } catch {
    return 0;
  }
}

/**
 * Ask for the motion/step permission that powers walk-away drive-end.
 * Android: the ACTIVITY_RECOGNITION runtime prompt. iOS: the plugin has
 * no explicit request — the first pedometer query triggers the Motion &
 * Fitness prompt, so we fire a probe query instead.
 */
export async function requestMotionPermission(): Promise<boolean> {
  const plugin = await guard();
  if (!plugin) return false;
  try {
    const r = await plugin.requestActivityRecognition();
    return r?.granted === true;
  } catch {
    try {
      await plugin.queryStepsSince({ fromMs: Date.now() - 60_000 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Arm/disarm native background revival (iOS).
 *
 * On iOS the JS tracker alone cannot survive app termination: standard
 * location updates never relaunch a terminated app, so an overnight
 * kill means every morning drive is lost until the user opens the app.
 * The native side registers significant-location-change, which DOES
 * relaunch, and captures to disk without needing the WebView.
 *
 * No-ops on web and on builds without the plugin.
 */
export async function setBackgroundRevival(
  enabled: boolean,
  companyId: string,
): Promise<void> {
  const plugin = await guard();
  if (!plugin) return;
  try {
    if (enabled) await plugin.enableBackgroundRevival({ companyId });
    else await plugin.disableBackgroundRevival();
  } catch {
    /* older binary without the native side */
  }
}

/**
 * Upload anything the native layer captured while the page was not
 * alive, then clear only what the server accepted.
 *
 * Late points are fine: the finalizer works over a 45-day window and
 * reconciles trips, so a commute drained at lunchtime still becomes a
 * correct trip. Ingest is idempotent, so overlapping with the live JS
 * flush costs nothing.
 *
 * Returns the number of points handed to the server (0 when there was
 * nothing, or on any failure — the buffer is left intact to retry).
 */
export async function drainNativeLocationBuffer(): Promise<number> {
  const plugin = await guard();
  if (!plugin) return 0;
  let points: Array<{
    ts: number;
    lat: number;
    lng: number;
    speedMps: number | null;
    accuracyM: number;
  }> = [];
  let companyId = "";
  try {
    const r = await plugin.drainBufferedLocations();
    points = r?.points ?? [];
    companyId = r?.companyId ?? "";
  } catch {
    return 0;
  }
  if (points.length === 0 || !companyId) return 0;
  const maxTs = points.reduce((a, p) => Math.max(a, p.ts), 0);
  try {
    const res = await fetch("/api/mileage/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ companyId, points }),
    });
    if (!res.ok) return 0;
    // Clear ONLY after the server confirmed, so a failed upload can
    // never lose a drive.
    await plugin.clearBufferedLocations({ upToTs: maxTs });
    return points.length;
  } catch {
    return 0;
  }
}
