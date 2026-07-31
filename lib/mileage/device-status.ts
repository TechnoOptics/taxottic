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
  getExitInfo(): Promise<Record<string, unknown>>;
  setExitBreadcrumb(opts: { note: string }): Promise<void>;
  addListener(
    event: "authorizationChanged",
    cb: (data: {
      locationAuthorization: DeviceStatus["locationAuthorization"];
      preciseLocation: boolean;
    }) => void,
  ): Promise<{ remove: () => void }>;
};

/**
 * Where a probe had got to when it stopped making progress.
 *
 * A time-boxed probe that reports only "timeout" cannot say WHICH await
 * hung, and the two candidates need completely different fixes:
 *
 *  bridge  we were still inside `await import("@capacitor/core")`. That
 *          is the JS module system, not the native layer: a cold or
 *          unfetchable chunk in a remote-URL WebView looks exactly like
 *          a dead plugin from the outside.
 *  call    the native method was invoked and its promise never settled.
 *          That is the bridge round-trip or the native side itself.
 *
 * Reported alongside the outcome so the next production sample answers
 * the question instead of narrowing it.
 */
export type DeviceProbeStage = "start" | "bridge" | "call" | "done";

type StageSink = (stage: DeviceProbeStage) => void;

async function guard(onStage?: StageSink): Promise<DeviceStatusPlugin | null> {
  try {
    onStage?.("bridge");
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
  return (await getDeviceStatusProbed()).value;
}

/**
 * Why a device-truth read produced what it produced.
 *
 *  ok          the plugin answered with data
 *  null        the plugin answered, but had nothing to report
 *  unavailable no bridge to ask (web, or registerPlugin itself failed)
 *  error       the bridge exists but the call rejected, which is what a
 *              plugin missing from the binary looks like
 *  timeout     the call never came back (added by the caller)
 *
 * Every plugin-sourced column has been NULL in production on 100% of
 * devices across both platforms, and the plain getters cannot say which
 * of these it was because they all collapse to null. The heartbeat
 * reports the outcome alongside the value so the next blackout does not
 * have to re-litigate that question.
 */
export type DeviceProbeOutcome =
  | "ok"
  | "null"
  | "unavailable"
  | "error"
  | "timeout";

export async function getDeviceStatusProbed(onStage?: StageSink): Promise<{
  value: DeviceStatus | null;
  outcome: DeviceProbeOutcome;
}> {
  onStage?.("start");
  const plugin = await guard(onStage);
  if (!plugin) return { value: null, outcome: "unavailable" };
  try {
    onStage?.("call");
    const value = await plugin.getStatus();
    onStage?.("done");
    if (!value) return { value: null, outcome: "null" };
    // Every successful read refreshes the foreground cache, wherever it
    // came from (heartbeat, wizard, resume). See the cache block below:
    // device truth changes slowly, so the last good read is a far better
    // answer than the NULL a timed-out background probe produces.
    writeDeviceStatusCache(value);
    return { value, outcome: "ok" };
  } catch {
    return { value: null, outcome: "error" };
  }
}

/* ------------------------------------------------------------------ *
 * Foreground cache
 *
 * The live probe reads device truth through the JS bridge at the exact
 * moment the JS bridge is least able to answer: the heartbeat fires
 * every ~5 min while tracking, which in practice means while the app is
 * backgrounded. Whatever starves that round-trip, the design is wrong
 * in the same way regardless.
 *
 * What is being read barely moves: a location authorization level, a
 * battery-optimization exemption, Background App Refresh. Those change
 * when a human changes them, not minute to minute. So the last value
 * read while the app was genuinely foregrounded is nearly as good as a
 * live one and infinitely better than NULL.
 *
 * The cache is a FALLBACK, never a replacement: the heartbeat still
 * probes live first and only falls back when the probe fails, and it
 * always transmits the capture age so a consumer can tell "battery
 * optimization was off 40 seconds ago" from "nine hours ago".
 * ------------------------------------------------------------------ */

const LS_DEVICE_STATUS = "taxottic.mileage.deviceStatus";

export type CachedDeviceStatus = {
  value: DeviceStatus;
  /** ms epoch of the read that produced `value`. */
  capturedAtMs: number;
  /** ms since that read, computed at read time. */
  ageMs: number;
};

function writeDeviceStatusCache(value: DeviceStatus): void {
  try {
    window.localStorage.setItem(
      LS_DEVICE_STATUS,
      JSON.stringify({ value, capturedAtMs: Date.now() }),
    );
  } catch {
    /* private mode / SSR: the cache is best-effort by design */
  }
}

/**
 * Last successful device-truth read, with its age. localStorage rather
 * than a module variable on purpose: a WebView revived in the
 * background after a process kill starts with an empty JS heap, and
 * that is precisely the situation where a live probe is least likely to
 * answer, so an in-memory cache would be empty exactly when it is
 * needed.
 */
export function readDeviceStatusCache(): CachedDeviceStatus | null {
  try {
    const raw = window.localStorage.getItem(LS_DEVICE_STATUS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      value?: DeviceStatus;
      capturedAtMs?: number;
    };
    if (!parsed?.value || typeof parsed.capturedAtMs !== "number") return null;
    return {
      value: parsed.value,
      capturedAtMs: parsed.capturedAtMs,
      ageMs: Math.max(0, Date.now() - parsed.capturedAtMs),
    };
  } catch {
    return null;
  }
}

/**
 * Refresh the cache from a live read. Call this only at moments the app
 * is genuinely foregrounded (app start, native appStateChange isActive),
 * which is when the bridge demonstrably works. Returns the outcome so a
 * caller can log it; the value lands in the cache as a side effect of
 * getDeviceStatusProbed above.
 */
export async function refreshDeviceStatusCache(): Promise<DeviceProbeOutcome> {
  return (await getDeviceStatusProbed()).outcome;
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

export type OsExitInfo = {
  /** Normalized slug, e.g. "excessive_resource_usage", "ios_watchdog". */
  reason: string;
  /** When the OS killed us, ms epoch. Null when the platform only gives
   *  us aggregate counters (iOS) rather than a timestamped event. */
  atMs: number | null;
  /** Full platform payload, kept for forensics. */
  detail: Record<string, unknown>;
};

/**
 * Ask the OS why it killed us last time.
 *
 * This is the difference between "tracking stopped" and "Android killed
 * the process for excessive resource usage while the foreground service
 * was alive" — the second is actionable, the first is a guess. Android
 * gives a per-event reason; iOS gives 24h counters, so we surface the
 * dominant non-normal counter as the reason.
 *
 * Returns null on web, on older OS versions, and whenever the platform
 * has nothing to report.
 */
export async function getOsExitInfo(): Promise<OsExitInfo | null> {
  return (await getOsExitInfoProbed()).value;
}

export async function getOsExitInfoProbed(onStage?: StageSink): Promise<{
  value: OsExitInfo | null;
  outcome: DeviceProbeOutcome;
}> {
  onStage?.("start");
  const plugin = await guard(onStage);
  if (!plugin) return { value: null, outcome: "unavailable" };
  let raw: Record<string, unknown>;
  try {
    onStage?.("call");
    raw = await plugin.getExitInfo();
    onStage?.("done");
  } catch {
    return { value: null, outcome: "error" };
  }
  // available:false is a real answer: API < 30, or the OS simply has no
  // exit record for us yet. That is NOT the same as an unreachable
  // bridge, and the outcome keeps them apart.
  if (!raw || raw.available !== true) return { value: null, outcome: "null" };

  if (raw.platform === "android") {
    return {
      value: {
        reason: String(raw.reasonName ?? "unknown"),
        atMs: typeof raw.timestamp === "number" ? raw.timestamp : null,
        detail: raw,
      },
      outcome: "ok",
    };
  }
  // iOS: pick the most diagnostic non-normal counter that is non-zero.
  // Ordered by how strongly each implicates OUR behaviour rather than
  // ordinary system housekeeping.
  const ranked: Array<[string, string]> = [
    ["suspendedWithLockedFile", "ios_suspended_with_locked_file"],
    ["bgTaskTimeout", "ios_bg_task_timeout"],
    ["watchdog", "ios_watchdog"],
    ["memoryLimit", "ios_memory_limit"],
    ["cpuLimit", "ios_cpu_limit"],
    ["memoryPressure", "ios_memory_pressure"],
    ["badAccess", "ios_bad_access"],
    ["illegalInstruction", "ios_illegal_instruction"],
    ["abnormal", "ios_abnormal"],
  ];
  for (const [key, slug] of ranked) {
    if (typeof raw[key] === "number" && (raw[key] as number) > 0) {
      return {
        value: { reason: slug, atMs: null, detail: raw },
        outcome: "ok",
      };
    }
  }
  return {
    value: { reason: "ios_normal", atMs: null, detail: raw },
    outcome: "ok",
  };
}

/** Record what we were doing, so the NEXT exit record explains itself.
 *  Android only; no-ops elsewhere. */
export async function setExitBreadcrumb(note: string): Promise<void> {
  const plugin = await guard();
  if (!plugin) return;
  try {
    await plugin.setExitBreadcrumb({ note });
  } catch {
    /* older binary */
  }
}
