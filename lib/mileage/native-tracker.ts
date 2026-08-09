// Phase 4, native background drive capture (client side).
//
// The device's ONLY job is to stream raw GPS points to
// /api/mileage/ingest. Every bit of intelligence (trip segmentation,
// classification, IRS deduction) is server-side and already unit-
// tested, see docs/MILEAGE_TRACKER_SPEC.md. So this module is
// deliberately thin: subscribe to the background-geolocation plugin,
// buffer points, flush them in batches.
//
// Plugin: @capgo/background-geolocation. We previously targeted
// @capacitor-community/background-geolocation, but its iOS Swift
// Package pinned capacitor-swift-pm 7.x while this app is on
// Capacitor 8, so `cap sync ios` could not resolve the SPM graph and
// the TestFlight archive failed. The Cap-go fork ships a Package.swift
// that depends on capacitor-swift-pm `from: 8.0.0`, so it resolves
// cleanly in the existing CapApp-SPM project, is free, and is more
// accurate than the community plugin. Its API is start()/stop()
// (not addWatcher/removeWatcher) but the option + location shapes are
// otherwise the same, so the buffer/flush/segmentation pipeline below
// is unchanged.
//
// Graceful-degradation discipline (the #69 "Browser plugin not
// implemented" regression): the plugin's native code is compiled
// INTO the app binary. On web, and on any installed build that
// predates this plugin, it is absent, every entry point guards on
// isNativePlatform() + isPluginAvailable("BackgroundGeolocation")
// and no-ops cleanly so the /mileage page still renders.

import type { GpsPoint } from "./segmentation";
import {
  STATIONARY_SPEED_MPS as DE_STATIONARY_SPEED_MPS,
  WALK_SPEED_MIN_MPS as DE_WALK_MIN_MPS,
  WALK_SPEED_MAX_MPS as DE_WALK_MAX_MPS,
  HARD_STOP_SPEED_MPS as DE_HARD_STOP_MPS,
  WALK_ARM_STOP_MS as DE_WALK_ARM_STOP_MS,
} from "./drive-end";
import { removeUploadedPoints, capBuffer } from "./buffer";
import { isArmInterrupted, parseArmLatch } from "./arm-latch";
import { WEB_BUILD_ID } from "@/lib/build-id";
import { getCarSignalsProbed } from "./car-signals";
import {
  ensureHeartbeatTimer,
  registerHeartbeatSender,
} from "./heartbeat-timer";
import {
  setBackgroundRevival,
  drainNativeLocationBuffer,
  setExitBreadcrumb,
  getDeviceStatusProbed,
  getOsExitInfoProbed,
  readDeviceStatusCache,
  refreshDeviceStatusCache,
} from "./device-status";
import type { DeviceProbeOutcome, DeviceProbeStage } from "./device-status";
import {
  drainGeofenceBuffer,
  stopGeofenceCapture,
  syncLearnedPlaces,
  getGeofenceState,
} from "./geofence";
import type { GeofenceArmState } from "./geofence";
import { haversineMeters } from "./segmentation";

// Minimal contract for the slice of @capgo/background-geolocation we
// use. Declared locally (rather than importing the package's types at
// module scope) so nothing from the native plugin is pulled into the
// web bundle's static graph, the package is only ever reached through
// the dynamic import in guard().
type BgLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  time: number | null;
};
type BgCallbackError = { message?: string; code?: string };
type BackgroundGeolocationPlugin = {
  start(
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (location?: BgLocation, error?: BgCallbackError) => void,
  ): Promise<void>;
  stop(): Promise<void>;
  openSettings(): Promise<void>;
};

const LS_ENABLED = "taxottic.mileage.enabled";
const LS_COMPANY = "taxottic.mileage.companyId";
const LS_BUFFER = "taxottic.mileage.buffer";
/** Eco mode bit, mirrored to localStorage by the schedule page so
 *  the native tracker can read it without a server round-trip on
 *  start(). "1" enables eco; anything else (including missing) is
 *  the default full-fidelity mode. */
const LS_ECO = "taxottic.mileage.eco";
/** Set immediately before the stop-then-start arm sequence and cleared
 *  once start() returns. A latch that survives means the sequence was
 *  interrupted with the background service already torn down. See
 *  lib/mileage/arm-latch.ts for why that is otherwise undetectable. */
const LS_ARMING = "taxottic.mileage.arming";
// Last heartbeat attempt outcome. Persisted because trackerDiag lives on a
// module object that every reload erases, and a reload is exactly when this
// question matters most.
const LS_HB_DIAG = "taxottic.mileage.heartbeatDiag";
/** Poison batches the server permanently rejected (400/413): moved out
 *  of the live buffer so they stop blocking the queue head, kept for
 *  diagnosis. Capped; oldest quarantined batches are discarded first. */
const LS_DEADLETTER = "taxottic.mileage.deadletter";
/** "1" while flushes are failing 401 after a refresh attempt — the
 *  session is genuinely dead and the user must sign in again. Read by
 *  MileageTrackingReminder; cleared on the next successful flush. */
const LS_AUTH_BLOCKED = "taxottic.mileage.authBlocked";
const AUTH_EVENT = "taxottic:mileage-auth";
/** Set when the background watcher reports a permission/authorization
 *  failure (location not set to "Always", or denied). The UI reads this
 *  to FORCE a fix instead of letting tracking fail silently. Self-clears
 *  the moment a real GPS fix arrives (permission is fine again). */
const LS_PERM = "taxottic.mileage.permBlocked";

function dispatchPermEvent(): void {
  try {
    window.dispatchEvent(new Event("taxottic:mileage-perm"));
  } catch {
    /* SSR / no window */
  }
}
function setPermBlocked(blocked: boolean): void {
  try {
    if (blocked) window.localStorage.setItem(LS_PERM, "1");
    else window.localStorage.removeItem(LS_PERM);
  } catch {
    /* private mode */
  }
  dispatchPermEvent();
}
/** A watcher error means "background tracking can't run": iOS "While
 *  Using" instead of "Always", location denied, or services off. Match
 *  broadly by code AND message so plugin-version differences don't slip
 *  a permission failure through as a silent stop. */
function isPermissionError(error: {
  code?: string;
  message?: string;
}): boolean {
  const c = String(error.code ?? "").toUpperCase();
  const m = String(error.message ?? "").toLowerCase();
  return (
    c === "NOT_AUTHORIZED" ||
    c === "PERMISSION_DENIED" ||
    c.includes("AUTH") ||
    c.includes("PERMISSION") ||
    /authoriz|permission|denied|always|location services|not enabled/.test(m)
  );
}

// Battery vs. fidelity. The segmentation core tolerates sparse points
// (it derives speed/dwell from gaps), so a 25 m filter is plenty for
// trip detection and keeps the GPS duty cycle low.
//
// Eco mode bumps this to 100 m (only emit a fix when the user has
// actually moved 100 m). On a Samsung the OS-fused provider sleeps
// the GPS sensor between fixes, net effect is roughly 4× less
// power. Trip polylines look the same to the eye; only the very
// first and very last points lose a little precision (matters for
// "start at exactly the office" auto-classify, not for the
// distance + deduction figures).
const DISTANCE_FILTER_M_DEFAULT = 25;
const DISTANCE_FILTER_M_ECO = 100;
// Flush when either threshold trips. Frequent enough that a force-kill
// loses little; the server de-dupes re-posted batches.
//
// (May 25 2026 rebuild) FLUSH_EVERY_MS dropped from 120_000 (2 min) to
// 30_000 (30 s) so a real drive's points hit the server WHILE the
// drive is happening, the previous cadence meant a 4-minute drive
// finished before the device ever called ingest, so nothing got
// staged and the "tail-close at end of stream" trick that
// materializes in-progress trips never ran. 30 s also keeps the
// staging→trip latency tight enough for an on-device demo: user
// parks, opens /mileage, sees the trip within a minute.
const FLUSH_AT_POINTS = 40;
const FLUSH_EVERY_MS = 30_000;
/** Max points sent per flush. CRITICAL (2026-06-01 on-device forensics):
 *  the flush fetch used `keepalive: true`, which the browser caps at a
 *  64 KB total request body. Once the buffer grew past ~700 points
 *  (~64 KB of JSON) EVERY flush threw `TypeError: Failed to fetch`, the
 *  batch was kept, and the buffer pegged at MAX_BUFFER (5000) on the
 *  user's phone with ZERO points ever reaching the server, proven on
 *  a Galaxy Z Fold5: a small POST returned 200, the same 179 KB body
 *  with keepalive threw, without keepalive returned normally. Fix is
 *  two-fold: drop keepalive (durability is already covered by the
 *  localStorage-persisted buffer + retry), and cap each POST to a sane
 *  size so a large backlog drains in steady chunks instead of one
 *  oversized request. 800 points ≈ 70 KB, comfortably small. */
const FLUSH_BATCH_MAX = 800;
/** Guard() timeout. The very first guard() call has to dynamic-import
 *  @capgo/background-geolocation, which has been observed to hang on
 *  Samsung WebViews after a fresh install. Capping the await keeps
 *  startMileageTracking from blocking forever; subsequent calls hit
 *  the cached `plugin` ref and don't pay this.
 *
 *  Bumped from 5 s → 10 s after a real-device 2026-05-26 incident
 *  where guard() finished at ~5-6 s on a cold start but
 *  guardWithTimeout had already returned null at the 5 s mark.
 *  Combined with the race-recovery fallback in startMileageTracking,
 *  this gives the first tap a much better chance to succeed without
 *  the user having to tap twice. */
const GUARD_TIMEOUT_MS = 10_000;
// Hard cap so a stuck network can't grow localStorage unbounded.
const MAX_BUFFER = 5_000;

type TrackingState = { supported: boolean; enabled: boolean };

let plugin: BackgroundGeolocationPlugin | null = null;
let tracking = false;
let buffer: GpsPoint[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
// Drive-end detection state (see lib/mileage/drive-end.ts): whether this
// session has actually driven, and the ts of the last moving fix (so the
// stationary duration and step window are measured from there).
let deHasDriven = false;
let driveEndPosting = false;
let deLastMovingTs = 0;
// GPS walk-away state: where the car stopped (first below-driving-speed
// fix after driving) and how many subsequent fixes landed in the
// walking-speed band. Permission-free walk detection — see drive-end.ts.
let deParkLat = 0;
let deParkLng = 0;
let deParkSet = false;
let deWalkFixes = 0;
let deWalkDisplacementM = 0;
// Anti-traffic guards: when the continuous hard stop began (0 = moving
// or creeping), the last two driving-speed fixes (for the pre-park
// heading), and the latest park→walker bearing delta.
let deHardStopStartTs = 0;
let dePrevDriveLat = 0;
let dePrevDriveLng = 0;
let dePrevDriveSet = false;
let deDriveBearingDeg: number | null = null;
let deWalkBearingDeltaDeg: number | null = null;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let watchdogRearming = false;
let authUnsub: (() => void) | null = null;
/** No callback for this long while enabled = the native service died
 *  under us (OS kill) while the toggle still says ON: the zombie state
 *  that previously required a manual off/on cycle. */
const WATCHDOG_STALL_MS = 10 * 60_000;
const WATCHDOG_MAX_RESTARTS = 3;
/** Watchdog tick period. */
const WATCHDOG_TICK_MS = 60_000;
/** A tick that arrives this much later than WATCHDOG_TICK_MS means our
 *  OWN timer was suspended or throttled, so the silence it is about to
 *  measure is our silence, not the watcher's. */
const WATCHDOG_THROTTLE_TICK_MS = 3 * WATCHDOG_TICK_MS;
/** When the previous watchdog tick ran. 0 = not armed yet. */
let watchdogLastTickAt = 0;
let flushing = false;
// The in-flight flush's promise, so a sessionEnded flush can WAIT for
// it instead of being silently dropped by the `flushing` guard (audit:
// the walk-away fast-close was dead code because maybeCloseDrive always
// collided with the same tick's heartbeat flush).
let flushPromise: Promise<boolean> | null = null;
let companyId = "";

/** Listeners notified when bg.start() settles (resolves OR rejects).
 *  AutoTrackToggle subscribes so the UI can flip back off if the
 *  native call fails AFTER the optimistic React flip. */
type StartListener = (result: { ok: boolean; error?: string }) => void;
const startListeners = new Set<StartListener>();
export function onTrackerStartSettle(cb: StartListener): () => void {
  startListeners.add(cb);
  return () => {
    startListeners.delete(cb);
  };
}

/** Debug breadcrumb of what guard() saw. Surfaced in the toggle's
 *  disabled state so we can diagnose "toggle disabled" reports
 *  without needing the host to run Chrome DevTools against the
 *  WebView. Updated synchronously inside guard() on every call. */
export const trackerDiag = {
  native: false as boolean,
  pluginAvailable: false as boolean,
  importOk: false as boolean,
  startFn: false as boolean,
  lastError: null as string | null,
  // Last result from startMileageTracking(), set when the native
  // bg.start() promise settles. Surfaced in the UI diag so we can
  // see the actual native return path without DevTools.
  startResult: "untouched" as string,
  startError: "" as string,
  cbHits: 0 as number,
  driveEndReason: "" as string,
  hbLastResult: "" as string,
  nativeDrained: 0 as number,
  cbLastError: "" as string,
  /** Consecutive failed flushes; drives the backoff (skip ticks). */
  failStreak: 0 as number,
  /** Points evicted at MAX_BUFFER (oldest dropped) — data loss signal. */
  evictedPoints: 0 as number,
  /** Batches quarantined after a permanent 4xx rejection. */
  deadlettered: 0 as number,
  /** Watchdog re-arms of a zombie watcher. */
  watchdogRestarts: 0 as number,
  /** ms epoch of the most recent plugin callback (fix OR error). */
  lastCbAt: 0 as number,
  // Last flush round-trip, populated by flush() so the toggle UI
  // can show "the device IS reaching the server" or "the device
  // sent 40 points and got 401 back" without DevTools.
  flushCount: 0 as number,
  flushLastStatus: 0 as number,
  flushLastResult: "" as string,
  flushLastTripsCreated: 0 as number,
  flushLastStagingLeft: 0 as number,
  /** Points recovered from the Android geofence resurrection buffer,
   *  i.e. a drive that happened while this page did not exist. */
  geofenceDrained: 0 as number,
  /** Learned places actually registered as geofences on this device. */
  geofenceSynced: 0 as number,
  /** Why the mesh is or is not armed. Null means never answered. */
  geofenceArmState: null as GeofenceArmState | null,
};

/** Race guard() against a timeout so the very first call doesn't
 *  hang forever if the dynamic import is slow. After the first
 *  resolution the `plugin` module-level ref is cached and subsequent
 *  guards return immediately. */
async function guardWithTimeout(): Promise<BackgroundGeolocationPlugin | null> {
  return Promise.race<BackgroundGeolocationPlugin | null>([
    guard(),
    new Promise<null>((resolve) =>
      setTimeout(() => {
        trackerDiag.lastError = "guard_timeout";
        resolve(null);
      }, GUARD_TIMEOUT_MS),
    ),
  ]);
}

async function guard(): Promise<BackgroundGeolocationPlugin | null> {
  if (typeof window === "undefined") return null;
  try {
    const { Capacitor } = await import("@capacitor/core");
    trackerDiag.native = Capacitor.isNativePlatform();
    trackerDiag.pluginAvailable = Capacitor.isPluginAvailable(
      "BackgroundGeolocation",
    );
    if (!trackerDiag.native || !trackerDiag.pluginAvailable) {
      return null;
    }
  } catch (e) {
    trackerDiag.lastError = `capacitor import: ${String(e)}`;
    return null;
  }
  if (!plugin) {
    try {
      const mod = await import("@capgo/background-geolocation");
      trackerDiag.importOk = true;
      const bg = mod.BackgroundGeolocation as unknown as
        | BackgroundGeolocationPlugin
        | undefined;
      trackerDiag.startFn = !!bg && typeof bg.start === "function";
      if (!bg || typeof bg.start !== "function") return null;
      plugin = bg;
    } catch (e) {
      // Package not in this bundle / native side absent, clean no-op.
      trackerDiag.lastError = `capgo import: ${String(e)}`;
      return null;
    }
  }
  return plugin;
}

/**
 * Stop the native watcher WITHOUT awaiting on Android.
 *
 * On Android the @capgo plugin's stop(), like start(), is callback-
 * style: its return is the Capacitor plugin proxy, NOT a real promise.
 * `await bg.stop()` therefore accesses `.then` on that proxy, which
 * Capacitor forwards to a native method literally named "then" (which
 * doesn't exist), throwing
 *   `"BackgroundGeolocation.then()" is not implemented on android`.
 * That surfaced as an uncaught exception on EVERY page load
 * (resume → start → stop) even though the call site try/caught it. So:
 * fire stop() WITHOUT touching `.then` on native (the call still
 * performs the stop), then give the native side a beat to tear the
 * orphaned foreground service down before the caller proceeds. The web
 * shim returns a genuine promise, so await it there.
 */
async function stopBgSafely(bg: BackgroundGeolocationPlugin): Promise<void> {
  try {
    if (trackerDiag.native) {
      bg.stop();
      await new Promise((r) => setTimeout(r, 150));
    } else {
      await (bg.stop() as unknown as Promise<void>);
    }
  } catch {
    /* no active session / already stopped, fine */
  }
}

function persistBuffer() {
  try {
    // The buffer is stored WITH its owning company (audit major #12):
    // a bare point array adopted by whichever company was active at
    // reload time attributed one company's miles — and deductions — to
    // another for multi-company drivers.
    window.localStorage.setItem(
      LS_BUFFER,
      JSON.stringify({ companyId, points: buffer }),
    );
  } catch {
    /* quota / disabled, in-memory buffer still flushes */
  }
}

function loadPersistedBuffer() {
  try {
    const raw = window.localStorage.getItem(LS_BUFFER);
    if (!raw) return;
    const parsed = JSON.parse(raw) as
      | GpsPoint[]
      | { companyId?: string; points?: GpsPoint[] };
    // Legacy shape: a bare array from a pre-provenance build. It has no
    // owner tag, so only adopt it for the company that was tracking
    // when it was written (LS_COMPANY is persisted in the same breath).
    if (Array.isArray(parsed)) {
      const owner = window.localStorage.getItem(LS_COMPANY);
      if (owner === companyId) buffer = parsed.slice(-MAX_BUFFER);
      return;
    }
    if (!parsed || !Array.isArray(parsed.points)) return;
    if (parsed.companyId && parsed.companyId !== companyId) {
      // Points captured for ANOTHER company: never adopt them here.
      // Leave them stored; that company's next tracking session (or its
      // next flush) uploads them under the right books.
      orphanBuffer = { companyId: parsed.companyId, points: parsed.points };
      return;
    }
    buffer = parsed.points.slice(-MAX_BUFFER);
  } catch {
    /* corrupt, drop it */
  }
}

/** Leftover points owned by a DIFFERENT company, found at start. Sent
 *  under their own companyId by drainOrphanBuffer so miles never jump
 *  books. */
let orphanBuffer: { companyId: string; points: GpsPoint[] } | null = null;

/**
 * POST JSON to our API, using the NATIVE HTTP stack when running in the
 * app and plain fetch on the web.
 *
 * Why this exists: Android throttles HTTP requests issued from the
 * WebView after roughly 5 minutes in the background. The
 * capacitor-community background-geolocation README documents exactly
 * this ("after 5 minutes in the background Android will throttle HTTP
 * requests initiated from the WebView. The solution is to use a native
 * HTTP plugin"), and Transistor Software's SDK docs say native upload
 * "is more reliable for background delivery than ad-hoc HTTP requests
 * from your own code". We had already adopted the OTHER half of that
 * same workaround (android.useLegacyBridge, which keeps the location
 * CALLBACKS firing) without ever moving the uploads.
 *
 * Symptom this fixes: on a long backgrounded drive the fixes keep being
 * captured but the flush stops landing, so the buffer grows toward
 * MAX_BUFFER and starts evicting oldest-first — real, silent data loss.
 *
 * Auth: verified on-device (emulator, CDP) that CapacitorHttp carries
 * our Supabase session cookie — a native POST and a WebView fetch to the
 * same authenticated endpoint returned the IDENTICAL status (403
 * not_a_member, which only fires AFTER the auth check passes). Falls
 * back to fetch if the plugin is missing or throws, so a bad native
 * path can never take uploads down.
 */
async function postJson(
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const webFetch = async () => {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(body),
    });
    let json: unknown = null;
    try {
      json = await res.clone().json();
    } catch {
      /* not JSON */
    }
    return { status: res.status, json };
  };

  let native = false;
  try {
    const w = window as unknown as {
      Capacitor?: { isNativePlatform?: () => boolean };
    };
    native = w.Capacitor?.isNativePlatform?.() === true;
  } catch {
    native = false;
  }
  if (!native) return webFetch();

  try {
    const { CapacitorHttp } = await import("@capacitor/core");
    const r = await CapacitorHttp.post({
      url: new URL(path, window.location.origin).toString(),
      headers: { "Content-Type": "application/json" },
      data: body,
    });
    return { status: r.status, json: r.data ?? null };
  } catch {
    // Native path unavailable/failed — never lose the upload over it.
    return webFetch();
  }
}

async function drainOrphanBuffer(): Promise<void> {
  if (!orphanBuffer || orphanBuffer.points.length === 0) {
    orphanBuffer = null;
    return;
  }
  const { companyId: owner, points } = orphanBuffer;
  try {
    const res = await postJson("/api/mileage/ingest", {
      companyId: owner,
      points,
      sessionEnded: true,
    });
    if (res.status >= 200 && res.status < 300) {
      orphanBuffer = null;
      trackerDiag.lastError = "";
    }
    // Non-2xx: keep the orphan in memory; the next start retries. The
    // points also remain in localStorage until persistBuffer overwrites,
    // which only happens after this drain on the happy path.
  } catch {
    /* offline — retry on the next start */
  }
}

/** POST buffered points to the Phase-2 ingestion route. Keeps points
 *  on failure (retry next tick); drops only what the server accepted.
 *
 *  Heartbeat mode: when tracking is active but the buffer is empty
 *  (user parked, plugin emitting nothing), we STILL call the server
 *  every flushTimer tick. The server re-segments the user's staging
 *  pool on every request, so an empty heartbeat is what materializes
 *  the "user has been parked for 5 min" trip closure. Without the
 *  heartbeat, parking → no new points → no flush → no segmentation
 *  → no trip ever materializes.
 */
/**
 * Drive-end check, run every flush tick while tracking. When the vehicle
 * has been stationary and the driver has walked away (step burst) — or
 * the stationary fallback elapses — force-close the trip with a
 * sessionEnded flush so it materializes in ~30s instead of the server's
 * 5-min parked timer. Decision logic is the unit-tested evaluateDriveEnd.
 */
async function maybeCloseDrive(): Promise<void> {
  if (!tracking || !deHasDriven || deLastMovingTs <= 0) return;
  const stationaryMs = Date.now() - deLastMovingTs;
  if (stationaryMs <= 0) return;
  let steps = 0;
  try {
    const { queryStepsSince } = await import("./device-status");
    steps = await queryStepsSince(deLastMovingTs);
  } catch {
    /* no motion plugin → steps 0, stationary fallback still applies */
  }
  const { evaluateDriveEnd } = await import("./drive-end");
  const decision = evaluateDriveEnd({
    hasDriven: true,
    stationaryMs,
    stepsSinceStationary: steps,
    walkDisplacementM: deWalkDisplacementM,
    walkingFixCount: deWalkFixes,
    walkArmed:
      deHardStopStartTs > 0 &&
      Date.now() - deHardStopStartTs >= DE_WALK_ARM_STOP_MS,
    walkBearingDeltaDeg: deWalkBearingDeltaDeg,
  });
  if (decision.close) {
    if (driveEndPosting) return;
    driveEndPosting = true;
    try {
      // Force-close FIRST; only consume the drive-end state once the
      // server confirmed (2xx). On failure everything stays armed, so
      // the very next tick re-evaluates and retries — the close can be
      // late, but it can no longer be lost.
      const ok = await flush({ sessionEnded: true });
      if (ok) {
        deHasDriven = false;
        deLastMovingTs = 0;
        deParkSet = false;
        deWalkFixes = 0;
        deWalkDisplacementM = 0;
        deHardStopStartTs = 0;
        deWalkBearingDeltaDeg = null;
        dePrevDriveSet = false;
        deDriveBearingDeg = null;
        trackerDiag.driveEndReason = decision.reason;
      } else {
        trackerDiag.driveEndReason = `retrying:${decision.reason}`;
      }
    } finally {
      driveEndPosting = false;
    }
  }
}

async function flush(opts?: { sessionEnded?: boolean }): Promise<boolean> {
  const sessionEnded = opts?.sessionEnded === true;
  if (flushing) {
    // Ordinary ticks can just skip — another flush is already moving the
    // queue. A sessionEnded flush must NEVER be dropped (it closes the
    // trip): wait out the in-flight one, then proceed.
    if (!sessionEnded) return false;
    while (flushing) {
      try {
        await flushPromise;
      } catch {
        /* the in-flight flush's own error handling already ran */
      }
    }
  }
  if (!companyId) return false;
  // Allow heartbeat (buffer.length === 0) WHILE tracking is active so
  // the server keeps re-segmenting staging. If we're not tracking and
  // the buffer is empty, nothing to do, UNLESS this is the
  // session-end flush, which must reach the server even with an empty
  // buffer so the server force-closes the in-progress trip (see the
  // sessionEnded handling in /api/mileage/ingest). Without this
  // override, toggling off after a drive whose last points already
  // flushed would never close the trip, it would sit open forever.
  if (buffer.length < 1 && !tracking && !sessionEnded) return false;
  // Backoff: after 3+ consecutive failures only attempt every 4th tick
  // (~2 min) so a dead session / server incident isn't hammered every
  // 30 s. sessionEnded always goes through (it closes the trip).
  if (
    trackerDiag.failStreak >= 3 &&
    !sessionEnded &&
    trackerDiag.flushCount % 4 !== 0
  ) {
    trackerDiag.flushCount++;
    return false;
  }
  flushing = true;
  trackerDiag.flushCount++;
  let resolveRun: (ok: boolean) => void = () => {};
  flushPromise = new Promise<boolean>((r) => {
    resolveRun = r;
  });
  let sent = false;
  // Cap the batch (see FLUSH_BATCH_MAX). NEVER use keepalive here: its
  // 64 KB body limit silently breaks every flush once the buffer is
  // non-trivial. A large backlog drains over successive ticks.
  const batch = buffer.slice(0, FLUSH_BATCH_MAX);
  try {
    const post = () =>
      postJson("/api/mileage/ingest", {
        companyId,
        points: batch,
        sessionEnded,
      });
    let res = await post();
    if (res.status === 401) {
      // Most likely a stale cookie after a long background (the OS
      // suspends the JS timers, so supabase-js autoRefresh never ran).
      // Refresh the session ONCE and retry this same batch; only a
      // second 401 means the session is genuinely dead.
      try {
        const { createClient } = await import("@/lib/supabase/client");
        await createClient().auth.refreshSession();
        res = await post();
      } catch {
        /* refresh unavailable (offline) — fall through to 401 handling */
      }
    }
    trackerDiag.flushLastStatus = res.status;
    const bodyJson: unknown = res.json;
    if (res.status >= 200 && res.status < 300) {
      sent = true;
      // Server staged everything; drop locally so we don't re-send
      // the same points. The server's staging table is authoritative
      // for "did this point land", we trust the 2xx.
      //
      // Removal is by TIMESTAMP IDENTITY, not position. The callback
      // keeps pushing during the request and MAX_BUFFER evicts from the
      // head, so a positional slice could delete newer points that were
      // never uploaded (see lib/mileage/buffer.test.ts).
      buffer = removeUploadedPoints(buffer, batch);
      persistBuffer();
      const j = bodyJson as
        | {
            tripsCreated?: number;
            stagingRemaining?: number;
          }
        | null;
      trackerDiag.flushLastTripsCreated = j?.tripsCreated ?? 0;
      trackerDiag.flushLastStagingLeft = j?.stagingRemaining ?? 0;
      trackerDiag.flushLastResult = `ok trips=${j?.tripsCreated ?? 0} left=${j?.stagingRemaining ?? 0}`;
      trackerDiag.failStreak = 0;
      if (localStorage.getItem(LS_AUTH_BLOCKED) === "1") {
        localStorage.removeItem(LS_AUTH_BLOCKED);
        window.dispatchEvent(new Event(AUTH_EVENT));
      }
    } else {
      const errBody = bodyJson ? JSON.stringify(bodyJson).slice(0, 60) : "";
      trackerDiag.flushLastResult = `${res.status} ${errBody}`;
      trackerDiag.failStreak++;
      if (res.status === 401) {
        // Refresh already failed above: the session is dead. Keep the
        // buffer (points are safe locally) but tell the user — a silent
        // 401 loop is how a full day of drives went missing before.
        try {
          localStorage.setItem(LS_AUTH_BLOCKED, "1");
          window.dispatchEvent(new Event(AUTH_EVENT));
        } catch {
          /* private mode */
        }
      } else if (res.status === 400 || res.status === 413) {
        // Permanent rejection: this batch will NEVER succeed, and as the
        // queue head it was blocking every point behind it. Quarantine
        // it to the dead-letter store and unblock the queue.
        try {
          const raw = localStorage.getItem(LS_DEADLETTER);
          const dead = raw ? (JSON.parse(raw) as unknown[]) : [];
          dead.push({ at: Date.now(), status: res.status, points: batch });
          while (dead.length > 5) dead.shift();
          localStorage.setItem(LS_DEADLETTER, JSON.stringify(dead));
        } catch {
          /* quota — drop without quarantine, unblocking still matters */
        }
        buffer = removeUploadedPoints(buffer, batch);
        persistBuffer();
        trackerDiag.deadlettered++;
      }
    }
  } catch (e) {
    // Offline / transient, keep the batch. Surface the error type
    // (TypeError = network unreachable; AbortError = timed out).
    trackerDiag.flushLastResult = `network: ${
      e instanceof Error ? e.name + ":" + e.message.slice(0, 40) : "unknown"
    }`;
    trackerDiag.failStreak++;
  } finally {
    flushing = false;
    resolveRun(sent);
    flushPromise = null;
  }
  return sent;
}

/**
 * Report device-truth to the server (reliability plan, workstream C):
 * toggle state, buffer depth, callback age, failure streak. Fired on
 * start/stop/resume and every ~5 min while tracking (every 10th flush
 * tick). Best-effort — a lost heartbeat costs nothing; the server keeps
 * the last one it saw. Native-plugin fields (authorization, battery)
 * join this payload when the DeviceStatus plugin ships.
 */
/** Time-box a native-bridge promise: a hung plugin call must degrade to
 *  null, never wedge the caller (observed: a device whose heartbeats
 *  stopped entirely while flushes kept working — the un-time-boxed
 *  getDeviceStatus await was the only difference between the paths). */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/* ------------------------------------------------------------------ *
 * Probe context: is the app actually in the foreground, and are our own
 * timers running?
 *
 * The first probed heartbeat from production came back
 * device_probe = "timeout" and exit_probe = "timeout": the bridge
 * exists, the plugin is registered, the OS is not returning empty, and
 * the call simply does not come back inside the time box. The standing
 * hypothesis is that heartbeats fire while backgrounded and the WebView
 * JS thread is too throttled to run the promise resolution. It is a
 * hypothesis. These three measurements are what turn it into an answer.
 * ------------------------------------------------------------------ */

/** Native app-state truth from @capacitor/app: the OS told us the app
 *  became active/inactive. null until the first event or getState()
 *  reply, so "unknown" is never silently reported as "background". */
let appActive: boolean | null = null;
let appStateWatchInstalled = false;

/**
 * Arm the foreground signal, and refresh the device-truth cache every
 * time the app genuinely comes forward.
 *
 * NOT document.visibilityState. Visibility-as-a-proxy-for-foreground is
 * the exact mistake that made the tracker watchdog dead code for
 * months (see the watchdog comment below): a WebView can be hidden
 * without the app being backgrounded and vice versa. `appStateChange`
 * is the OS's own statement about the app process. visibilityState is
 * still recorded in the heartbeat, but explicitly as a second, weaker
 * signal that we can compare against the real one rather than as the
 * thing we act on.
 *
 * Idempotent; safe to call from every entry point.
 */
function installAppStateWatch(): void {
  if (appStateWatchInstalled || typeof window === "undefined") return;
  appStateWatchInstalled = true;
  void (async () => {
    try {
      const { App } = await import("@capacitor/app");
      // Seed from the OS rather than assuming: a cold start triggered by
      // a background relaunch is NOT foreground, and guessing "true"
      // there would poison exactly the rows we care about.
      const seed = await within(App.getState(), 2_000);
      if (seed && typeof seed.isActive === "boolean") appActive = seed.isActive;
      void App.addListener("appStateChange", ({ isActive }) => {
        appActive = isActive;
        // A genuine foregrounding. This is the moment the bridge
        // demonstrably answers, so it is the moment to capture device
        // truth for every heartbeat that follows.
        if (isActive) void refreshDeviceStatusCache().catch(() => {});
      });
    } catch {
      /* web / @capacitor/app absent: appActive stays null (unknown) */
    }
  })();
  // Secondary trigger only. A visibility gain is never treated as proof
  // of foreground, but it is a harmless extra chance to refresh the
  // cache while the JS thread is demonstrably running.
  try {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void refreshDeviceStatusCache().catch(() => {});
      }
    });
  } catch {
    /* SSR / no document */
  }
}

/**
 * How late a short timer actually ran, in ms.
 *
 * This is the load-bearing measurement for the throttling hypothesis,
 * and it cuts in a direction that is easy to get backwards. The probe
 * time box is itself a setTimeout. If Chromium were throttling this
 * WebView's timers, the time box would fire LATE, not early, handing
 * the bridge MORE wall time, not less. So:
 *
 *   lag small + probe timed out  the JS thread was running fine and the
 *                                native call genuinely did not answer.
 *                                The throttling hypothesis is dead.
 *   lag large                    our timers really were being starved,
 *                                and the measured probe elapsed will be
 *                                far greater than the 3000 ms box.
 *
 * Started before the probes and awaited after, so it costs no added
 * latency.
 */
function measureTimerLag(ms: number): Promise<number> {
  const startedAt = Date.now();
  return new Promise<number>((resolve) =>
    setTimeout(() => resolve(Math.max(0, Date.now() - startedAt - ms)), ms),
  );
}

/** Time-box a probed bridge read (see device-status.ts) without losing
 *  WHY it produced what it produced. `within()` above collapses "the
 *  plugin answered with nothing", "the plugin rejected" and "the plugin
 *  never answered" into one null, which is exactly the ambiguity that
 *  has kept the device-truth NULL investigation stuck: every
 *  plugin-sourced column is null in production on both platforms and
 *  the row cannot say why.
 *
 *  Also reports the measured wall-clock elapsed and the last stage the
 *  probe reached, so a "timeout" says how long it really waited (vs the
 *  nominal box) and which await it was sitting in. */
async function probeWithin<T>(
  fn: (onStage: (s: DeviceProbeStage) => void) => Promise<{
    value: T | null;
    outcome: DeviceProbeOutcome;
  }>,
  ms: number,
): Promise<{
  value: T | null;
  outcome: DeviceProbeOutcome;
  ms: number;
  stage: DeviceProbeStage;
}> {
  const startedAt = Date.now();
  let stage: DeviceProbeStage = "start";
  const onStage = (s: DeviceProbeStage) => {
    stage = s;
  };
  const timeout = new Promise<{
    value: T | null;
    outcome: DeviceProbeOutcome;
  }>((resolve) =>
    setTimeout(() => resolve({ value: null, outcome: "timeout" }), ms),
  );
  const run = Promise.resolve()
    .then(() => fn(onStage))
    .catch(() => ({ value: null, outcome: "error" as DeviceProbeOutcome }));
  const settled = await Promise.race([run, timeout]);
  return { ...settled, ms: Date.now() - startedAt, stage };
}


export async function sendHeartbeat(): Promise<void> {
  if (!companyId) return;
  installAppStateWatch();
  try {
    const cap = (window as unknown as {
      Capacitor?: { getPlatform?: () => string };
    }).Capacitor;
    // Native device truth (authorization level, battery optimization)
    // when the DeviceStatus plugin is in this binary; null on web/old
    // builds and the heartbeat still carries the JS-visible fields.
    // TIME-BOXED: device truth is a bonus, the heartbeat itself is the
    // point — it must go out even when the native bridge is wedged.
    // Called through the STATIC import above, not a dynamic one.
    //
    // This used to be `import("@/lib/mileage/device-status")` inside a
    // 3s timeout — a different specifier for a module this file already
    // imports relatively. Mixed specifiers can resolve to a separate
    // lazy chunk, and if that chunk is slow or unfetchable (remote-URL
    // WebView, backgrounded, poor signal) the timeout fires and EVERY
    // device field lands as null at once. That matches production
    // exactly: location_authorization / precise_location /
    // battery_optimized / low_power_mode were null on 100%% of devices
    // on BOTH platforms — even on Android, where the native plugin
    // demonstrably works (verified live over CDP) — while app_version
    // survived because @capacitor/app is already-loaded vendor code.
    // A JS-layer cause is the only kind that explains a cross-platform
    // symptom with a healthy native layer.
    //
    // FIRST PRODUCTION RESULT of that probe: device_probe = "timeout"
    // and exit_probe = "timeout" on Android. So it is not registration,
    // not a missing binary, not an empty OS answer, and not the lazy
    // chunk either. The call is issued and does not come back inside the
    // box. What is NOT yet established is why, hence the three context
    // measurements attached below (foreground, elapsed, timer lag) and
    // the stage recorded inside each probe.
    //
    // Started first, resolved last: a free reading of whether our own
    // timers ran while the probes were in flight.
    const timerLag = measureTimerLag(1_000);
    const dsProbe = await probeWithin(getDeviceStatusProbed, 3_000);
    const ds = dsProbe.value;
    // App version (was never sent — the manager health view showed
    // app_version null for every device). Guarded + time-boxed like
    // everything else on the bridge.
    const exitProbe = await probeWithin(getOsExitInfoProbed, 2_000);
    const exitInfo = exitProbe.value;
    // Car connection (CarPlay / Android Auto / car Bluetooth). Time-boxed
    // like its siblings and for the same reason: this rides the JS-to-native
    // call path that has never once answered for device truth, so it must
    // never be able to hold up the heartbeat itself.
    const carProbe = await probeWithin(
      () => getCarSignalsProbed(),
      2_000,
    );
    const timerLagMs = Math.round(await timerLag);
    // Device truth, live if the probe answered and cached otherwise.
    // The cache is only ever written by a SUCCESSFUL read (see
    // device-status.ts), and its age travels with it, so a nine-hour-old
    // value can never be mistaken for a current one.
    const cached = ds ? null : readDeviceStatusCache();
    const truth = ds ?? cached?.value ?? null;
    const truthSource = ds ? "live" : cached ? "cache" : "none";
    const truthAgeS = ds
      ? 0
      : cached
        ? Math.round(cached.ageMs / 1000)
        : null;
    // Geofence resurrection net health. Time-boxed like every other
    // bridge read: this is diagnosis, the heartbeat itself is the point.
    const geofence = await within(getGeofenceState(), 2_000).catch(() => null);
    let appVersion: string | null = null;
    try {
      const info = await within(
        import("@capacitor/app").then((m) => m.App.getInfo()),
        2_000,
      );
      appVersion = info?.version ?? null;
    } catch {
      /* web / plugin missing */
    }
    const res = await fetch("/api/mileage/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        companyId,
        platform: cap?.getPlatform?.() ?? "web",
        appVersion,
        // WHICH JS BUNDLE produced this heartbeat. `appVersion` above is the
        // NATIVE binary and says nothing about the web code actually running,
        // because this app is a WebView on a remote url whose service worker
        // can serve a bundle days older than the binary. Without this, a
        // device-truth failure cannot be told apart from a device that never
        // received the fix for it. See lib/build-id.ts.
        webBuild: WEB_BUILD_ID,
        trackingEnabled: tracking,
        bufferSize: buffer.length,
        lastCbAgeS: trackerDiag.lastCbAt
          ? Math.round((Date.now() - trackerDiag.lastCbAt) / 1000)
          : null,
        failStreak: trackerDiag.failStreak,
        locationAuthorization: truth?.locationAuthorization ?? null,
        preciseLocation: truth?.preciseLocation ?? null,
        batteryOptimized: truth?.batteryOptimized ?? null,
        lowPowerMode: truth?.lowPowerMode ?? null,
        // Background App Refresh OFF means iOS relaunches us for NO
        // location event — SLC and geofences both go dead silent with
        // no error to log. The device could always read this; it was
        // never transmitted, so the blocker stayed invisible.
        backgroundRefresh: truth?.backgroundRefresh ?? null,
        // Where the five fields above came from, and how old they are.
        // Without these a cached value is indistinguishable from a live
        // one, which would trade a visible NULL for an invisible lie.
        // "live" = this heartbeat's probe answered (age 0). "cache" =
        // the last successful foreground read, age in seconds. "none" =
        // still nothing, which is the honest NULL.
        deviceStatusSource: truthSource,
        deviceStatusAgeS: truthAgeS,
        // Why the OS killed us last time. Reported once per heartbeat;
        // cheap, and it converts 'tracking mysteriously stopped' into a
        // named cause (Samsung battery kill vs force-stop vs OOM vs a
        // revoked permission).
        exitReason: exitInfo?.reason ?? null,
        exitAtMs: exitInfo?.atMs ?? null,
        exitDetail: exitInfo?.detail ?? null,
        // Whether the bridge answered at all, so a null field above is
        // no longer ambiguous between "nothing to report" and "the
        // plugin is unreachable from this WebView".
        deviceProbe: dsProbe.outcome,
        exitProbe: exitProbe.outcome,
        // How long each probe actually took, and where it had got to.
        // A "timeout" whose elapsed is ~3000 ms proves our timers ran on
        // schedule (so the JS thread was NOT throttled and the native
        // call is the thing that did not answer). A "timeout" whose
        // elapsed is far greater proves the opposite: the time box
        // itself fired late because our timers were starved. The stage
        // separates "hung importing @capacitor/core" from "hung waiting
        // on the native method".
        deviceProbeMs: dsProbe.ms,
        deviceProbeStage: dsProbe.stage,
        exitProbeMs: exitProbe.ms,
        exitProbeStage: exitProbe.stage,
        // Was the app actually in the foreground when the probes ran?
        // appActive is the OS's own statement via @capacitor/app
        // appStateChange (null = we have not heard from it yet, never
        // guessed). probeVisibility is document.visibilityState, kept
        // ONLY as a weaker cross-check: using visibility as a proxy for
        // foreground is a mistake this codebase has already made once.
        probeForeground: appActive,
        probeVisibility:
          typeof document === "undefined" ? null : document.visibilityState,
        // Whether a plain 1 s timer ran on time while the probes were in
        // flight. See measureTimerLag.
        timerLagMs,
        // When an arm sequence was started and never finished. Non-null
        // means a previous stop-then-start died between the two calls,
        // leaving the background service DOWN with the UI still claiming
        // tracking is on. Distinguishes "we tore it down and never put it
        // back" from "the OS killed it", which look identical otherwise
        // and want different fixes. See lib/mileage/arm-latch.ts.
        armInterruptedAt: (() => {
          try {
            const latch = parseArmLatch(
              window.localStorage.getItem(LS_ARMING),
            );
            return isArmInterrupted(latch, Date.now()) ? latch : null;
          } catch {
            return null;
          }
        })(),
        // CAR CONNECTION (CarPlay, Android Auto, car Bluetooth, car audio).
        //
        // The native detection for this has existed on BOTH platforms for
        // some time (TaxotticCarSignalsPlugin on Android,
        // TaxotticVehicleSignals on iOS) and has never reported a single
        // row, because nothing ever called it and there was nowhere to put
        // the answer. This is that wiring.
        //
        // Reported with an explicit OUTCOME, not just a value. The pull path
        // it depends on is the same JS-to-native call that has failed on 450
        // of 450 device-truth heartbeats, so there is a real chance this
        // reports `timeout` forever. If it does, that is a FINDING and not a
        // blank: `car_probe` will say so, and it doubles as a second
        // independent probe of whether the bridge answers at all.
        //
        // Time-boxed at 2s, shorter than the 3s device probe, because a
        // heartbeat that never sends is worse than one missing a field.
        carProbe: carProbe.outcome,
        carProbeMs: carProbe.ms,
        // projectionType is the CarPlay / Android Auto signal specifically;
        // the connect counters and adapter state separate "no car" from
        // "we cannot see cars".
        carProjectionType: carProbe.value?.projectionType ?? null,
        carProjectionObserved: carProbe.value?.projectionObserved ?? null,
        carConnects: carProbe.value?.vehicleConnects ?? null,
        carDisconnects: carProbe.value?.vehicleDisconnects ?? null,
        carBluetoothAdapter: carProbe.value?.bluetoothAdapter ?? null,
        carPendingSignals: carProbe.value?.pendingSignals ?? null,
        // Learned-place geofence mesh. Without these, a device whose
        // mesh silently failed to register looks identical to one that
        // simply had no drives, which is the ambiguity that let a
        // week of missing morning commutes pass unnoticed.
        //
        // geofenceCapture is the load-bearing one: "blind_no_fix" means
        // a geofence exit DID start the service and it received no
        // location, i.e. the permission reported granted and was not
        // actually usable. That is a real failure and must never be
        // reported as a healthy tracking day.
        geofenceArmState: geofence?.armState ?? null,
        geofenceCount: geofence?.registeredCount ?? null,
        geofenceCapture: geofence?.lastCapture?.state ?? null,
        geofenceBufferedFixes: geofence?.bufferedFixes ?? null,
      }),
    });
    trackerDiag.hbLastResult = `${res.status} @ ${new Date()
      .toISOString()
      .slice(11, 19)}`;
    writeHeartbeatDiag(res.ok ? "ok" : "http", String(res.status));
  } catch (e) {
    trackerDiag.hbLastResult =
      "err:" + String((e as Error)?.message ?? e).slice(0, 60);
    writeHeartbeatDiag("throw", String((e as Error)?.message ?? e));
  }
}


// Hand the sender to the timer module. Module scope on purpose: any ingest
// path can then arm the heartbeat without importing this file, which would
// be a cycle (this file imports device-status, one of those paths).
registerHeartbeatSender(() => {
  void sendHeartbeat();
});

/**
 * Persist the outcome of the last heartbeat attempt.
 *
 * trackerDiag.hbLastResult already recorded this, and NOTHING EVER READ IT.
 * It lives on a module object, so it is also erased by every reload, which
 * on this app happens whenever the service worker takes over. The result:
 * both devices went 27+ hours without a single heartbeat row while their
 * GPS upload kept working perfectly, and there was no way to tell whether
 * the POST was failing, throwing, or never being attempted.
 *
 * That ambiguity is the bug. Every alarm built on 2026-08-08 (the stall
 * sweep, the foreground-only detector, arm_interrupted_at, web_build) reads
 * heartbeats, so a silent heartbeat outage blinds all of them at once while
 * each individually looks healthy.
 *
 * Written to localStorage so it survives a reload, and rendered on the
 * mileage diagnostics screen so it can be read ON THE PHONE without a
 * cable, a console, or a working heartbeat. Deliberately not dependent on
 * the heartbeat succeeding: a diagnostic that only reports when the thing
 * it diagnoses is working is not a diagnostic.
 */
function writeHeartbeatDiag(kind: "ok" | "http" | "throw", detail: string) {
  try {
    window.localStorage.setItem(
      LS_HB_DIAG,
      JSON.stringify({ kind, detail: detail.slice(0, 120), atMs: Date.now() }),
    );
  } catch {
    /* private mode: the in-memory trackerDiag above still has it */
  }
}

export type HeartbeatDiag = {
  kind: "ok" | "http" | "throw";
  detail: string;
  atMs: number;
  ageMs: number;
};

/** Last heartbeat outcome, with its age. Null when none was ever attempted,
 *  which is itself the answer to "is the heartbeat even being called". */
export function readHeartbeatDiag(): HeartbeatDiag | null {
  try {
    const raw = window.localStorage.getItem(LS_HB_DIAG);
    if (!raw) return null;
    const p = JSON.parse(raw) as Omit<HeartbeatDiag, "ageMs">;
    if (!p || typeof p.atMs !== "number") return null;
    return { ...p, ageMs: Date.now() - p.atMs };
  } catch {
    return null;
  }
}

/** Initial bearing from a to b, degrees 0-360. */
function bearingDegrees(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const toRad = Math.PI / 180;
  const dLng = (b.lng - a.lng) * toRad;
  const la1 = a.lat * toRad;
  const la2 = b.lat * toRad;
  const y = Math.sin(dLng) * Math.cos(la2);
  const x =
    Math.cos(la1) * Math.sin(la2) -
    Math.sin(la1) * Math.cos(la2) * Math.cos(dLng);
  return (Math.atan2(y, x) * (180 / Math.PI) + 360) % 360;
}

/** Smallest angle between two bearings, degrees 0-180. */
function bearingDeltaDegrees(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/** Map a plugin Location → the server's GpsPoint contract. */
function toPoint(p: {
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number | null;
  time: number | null;
}): GpsPoint | null {
  if (!Number.isFinite(p.latitude) || !Number.isFinite(p.longitude)) {
    return null;
  }
  return {
    lat: p.latitude,
    lng: p.longitude,
    ts: typeof p.time === "number" && p.time > 0 ? p.time : Date.now(),
    speedMps:
      typeof p.speed === "number" && p.speed >= 0 ? p.speed : undefined,
    accuracyM:
      typeof p.accuracy === "number" && p.accuracy >= 0
        ? p.accuracy
        : undefined,
  };
}

/**
 * Start streaming drives for `forCompanyId`. Idempotent (a second
 * call while tracking is live is a no-op). Persists the preference
 * so resumeMileageTrackingIfEnabled() can re-arm on a cold start -
 * the plugin's tracking session does NOT survive a process kill.
 */
export async function startMileageTracking(
  forCompanyId: string,
): Promise<{ ok: boolean; error?: string }> {
  trackerDiag.startResult = "entered";
  // Arm the foreground signal + the foreground device-truth cache before
  // anything else. Starting tracking is itself a foreground moment, so
  // the very first heartbeat already has a cached value to fall back on
  // if its live probe times out.
  installAppStateWatch();
  void refreshDeviceStatusCache().catch(() => {});
  // Prefer the cached plugin; if not yet loaded, AWAIT guardWithTimeout
  // so the first tap actually starts tracking instead of silently
  // returning "warming" and requiring a second tap. Capped at
  // GUARD_TIMEOUT_MS so a stuck dynamic import doesn't block forever.
  //
  // RACE RECOVERY (2026-05-26): a real-device diag line showed
  // `plug=true imp=true start=true call=unsupported err=guard_timeout`.
  // guardWithTimeout's 5s timeout fired BEFORE guard() finished, so
  // `bg` was null at the await boundary, but guard() finished a few
  // hundred ms later and cached `plugin = bg`. The previous error
  // branch then read a stale `plugin === null` and reported unsupported.
  // Fix: after the await, re-check the module-level `plugin` cache.
  // If guard() finished during our timeout window, grab it now and
  // continue normally. Saves the user from having to tap the toggle
  // twice on a slow first cold-start.
  let bg = plugin ?? (await guardWithTimeout());
  if (!bg && plugin) {
    // guard() raced past the timeout, use the cached ref.
    bg = plugin;
  }
  if (!bg) {
    trackerDiag.startResult =
      trackerDiag.lastError === "guard_timeout"
        ? "guard_timeout"
        : "unsupported";
    return { ok: false, error: trackerDiag.startResult };
  }
  if (tracking) {
    trackerDiag.startResult = "already_tracking";
    return { ok: true };
  }

  companyId = forCompanyId;
  try {
    window.localStorage.setItem(LS_ENABLED, "1");
    // Arm native background revival (iOS). Standard location updates
    // never relaunch a terminated app, so without this an overnight
    // kill loses every morning drive until the user opens the app.
    void setBackgroundRevival(true, forCompanyId);
    // Breadcrumb the NEXT exit record: if the OS kills us mid-drive we
    // want the record to say tracking was on.
    void setExitBreadcrumb(`tracking=on;co=${forCompanyId.slice(0, 8)}`);
    window.localStorage.setItem(LS_COMPANY, forCompanyId);
  } catch {
    /* private mode, tracking still works for this session */
  }
  loadPersistedBuffer();
  void drainOrphanBuffer();

  // CRITICAL (2026-05-26): always call bg.stop() before bg.start() to
  // kill any orphaned foreground service from a previous WebView
  // session.
  //
  // Real-world failure: user drove, server received zero points across
  // the entire drive. Diag showed cbErr=ALREADY_STARTED. Root cause:
  // when Android kills the JS process but the @capgo foreground
  // service survives (which it does, that's the whole point of a
  // foreground service), the NEXT JS run's bg.start() returns the
  // ALREADY_STARTED error AND DOES NOT REGISTER THE NEW LOCATION
  // CALLBACK. The orphaned old callback (in dead JS context) stays
  // the only listener, so every fix during the drive went to /dev/null.
  //
  // Pre-stopping forces the native side to tear down the orphaned
  // service so the subsequent start() builds a fresh subscription
  // with our live callback. stopBgSafely never awaits `.then` on the
  // native proxy (see its doc) so it can't throw the
  // "BackgroundGeolocation.then()" error this used to spew on launch.
  //
  // ARMING LATCH. Stamped immediately BEFORE the stop and cleared after
  // start() returns, so an arm that dies in between leaves proof.
  //
  // The stop is mandatory (see ALREADY_STARTED above), but it means that
  // for the duration of this sequence the background service is DOWN. If
  // this JS context is suspended or killed at the await (a backgrounded
  // iOS WebView, an Android process kill, a page reload), the service
  // stays down and nothing here runs again to restart it. The UI still
  // reads "tracking on" and the device still heartbeats whenever the app
  // is opened, so the outage is invisible from the server and looks
  // exactly like a parked phone. Without this latch there is no way,
  // after the fact, to tell "never armed" from "armed and then torn down
  // by us halfway through".
  try {
    window.localStorage.setItem(LS_ARMING, String(Date.now()));
  } catch {
    /* private mode: we lose the evidence, not the tracking */
  }

  await stopBgSafely(bg);

  // Fire-and-forget start(). Promise rejection / callback errors
  // are captured into trackerDiag so the UI's diag line shows the
  // exact native return path without DevTools.
  trackerDiag.startResult = "calling";
  trackerDiag.startError = "";
  trackerDiag.cbHits = 0;
  trackerDiag.cbLastError = "";
  // Eco mode: bigger distanceFilter + accept stale (cached) fixes.
  // localStorage flag is mirrored by /mileage/schedule when the
  // user saves; default is full-fidelity tracking.
  let eco = false;
  try {
    eco = window.localStorage.getItem(LS_ECO) === "1";
  } catch {
    /* private mode, default to full fidelity */
  }
  const distanceFilter = eco
    ? DISTANCE_FILTER_M_ECO
    : DISTANCE_FILTER_M_DEFAULT;
  try {
    // CRITICAL (2026-06-01 on-device forensics, Galaxy Z Fold5):
    // bg.start(options, callback) is a CALLBACK method, not a Promise
    // method, on Android. Its return value is NOT a thenable, calling
    // `.then()` on it proxies to a native method literally named "then"
    // that doesn't exist, throwing
    //   `"BackgroundGeolocation.then()" is not implemented on android`.
    // The old `.start(...).then(...).catch(...)` chain therefore tripped
    // the rejection path on EVERY start, flipping tracking off and
    // writing LS_ENABLED="0" the instant tracking began, even though the
    // native foreground service was alive and delivering GPS fixes. So:
    // fire start() and DON'T chain. Success is reported optimistically
    // (the call returned without throwing); real failures arrive through
    // the callback's `error` arg (e.g. NOT_AUTHORIZED → stop). The web
    // shim DOES return a genuine Promise, so we observe that for late
    // rejections ONLY off-native (guarded by trackerDiag.native).
    const startRet = bg.start(
      {
        backgroundMessage:
          "Logging your drive for the mileage deduction. Tap to open.",
        backgroundTitle: "Taxottic mileage",
        requestPermissions: true,
        // Accept a recent cached fix from the OS-fused provider instead
        // of forcing a fresh GPS sample on every trigger. The team's own
        // on-device notes call stale-OK "the bigger battery win on
        // Samsung"; it's now ON by default (was eco-only) so the app is
        // battery-friendly out of the box. Safe for capture: segmentation
        // tolerates slightly-aged fixes and the trip DISTANCE + IRS
        // deduction (derived point-to-point) are unaffected, only the
        // exact timestamp of a fix can lag a beat. Eco mode still layers
        // the bigger 100 m distanceFilter saving on top of this.
        stale: true,
        distanceFilter,
      },
      (location, error) => {
        trackerDiag.cbHits++;
        trackerDiag.lastCbAt = Date.now();
      // A real fix proves the watcher is alive, so the restart budget
      // resets. It used to be a per-SESSION cap of 3 that a parked
      // phone (no fixes while stationary, which is correct behaviour)
      // burned through — leaving nothing left for an actual zombie
      // tracker later in the same session (audit #30).
      trackerDiag.watchdogRestarts = 0;
        if (error) {
          trackerDiag.cbLastError =
            String(error.code ?? "") + ":" + String(error.message ?? "");
          // Permission problem (not "Always", denied, services off):
          // flag it so the UI forces a fix, then stop so we don't spin.
          if (isPermissionError(error)) {
            setPermBlocked(true);
            void stopMileageTracking();
          }
          return;
        }
        if (!location) return;
        // A real fix arrived → permission is fine. Clear any stale
        // warning (only touch storage when it was actually set, so we
        // aren't writing localStorage on every 2-second fix).
        try {
          if (window.localStorage.getItem(LS_PERM) === "1") {
            setPermBlocked(false);
          }
        } catch {
          /* private mode */
        }
        const pt = toPoint(location);
        if (!pt) return;
        // Drive-end tracking: a fix above driving speed means we're
        // moving; remember when. Below it, the vehicle is stationary and
        // deLastMovingTs stops advancing, so its age = time parked.
        const spd = pt.speedMps ?? 0;
        if (spd >= DE_STATIONARY_SPEED_MPS) {
          deHasDriven = true;
          deLastMovingTs = pt.ts;
        }
        if (spd > DE_WALK_MAX_MPS) {
          // Unambiguous driving. Any walk evidence was traffic creep or
          // noise — reset EVERYTHING, including the hard-stop clock, and
          // update the driving heading (used to tell a walker leaving
          // the road from a jam creeping along it).
          if (dePrevDriveSet) {
            deDriveBearingDeg = bearingDegrees(
              { lat: dePrevDriveLat, lng: dePrevDriveLng },
              { lat: pt.lat, lng: pt.lng },
            );
          }
          dePrevDriveLat = pt.lat;
          dePrevDriveLng = pt.lng;
          dePrevDriveSet = true;
          deParkSet = false;
          deWalkFixes = 0;
          deWalkDisplacementM = 0;
          deHardStopStartTs = 0;
          deWalkBearingDeltaDeg = null;
        } else if (deHasDriven) {
          const armed =
            deHardStopStartTs > 0 &&
            pt.ts - deHardStopStartTs >= DE_WALK_ARM_STOP_MS;
          if (spd < DE_HARD_STOP_MPS) {
            // Genuinely still. Start (or continue) the hard-stop clock;
            // the park point is where the stop BEGAN.
            if (deHardStopStartTs === 0) {
              deHardStopStartTs = pt.ts;
              deParkLat = pt.lat;
              deParkLng = pt.lng;
              deParkSet = true;
            }
          } else if (!armed) {
            // Sub-driving movement BEFORE a qualifying hard stop: that is
            // a car creeping in traffic, never a walker (you cannot walk
            // away from a car that hasn't stopped). Reset the clock — a
            // real park will restart it and pass with ease.
            deHardStopStartTs = 0;
            deParkSet = false;
            deWalkFixes = 0;
            deWalkDisplacementM = 0;
            deWalkBearingDeltaDeg = null;
          } else if (spd >= DE_WALK_MIN_MPS && spd <= DE_WALK_MAX_MPS) {
            // Armed (real park happened) and moving at walking pace:
            // candidate walker. Track displacement AND how far the path
            // has diverged from the road's axis.
            deWalkFixes++;
            deWalkDisplacementM = haversineMeters(
              { lat: deParkLat, lng: deParkLng },
              { lat: pt.lat, lng: pt.lng },
            );
            deWalkBearingDeltaDeg =
              deDriveBearingDeg == null
                ? null
                : bearingDeltaDegrees(
                    deDriveBearingDeg,
                    bearingDegrees(
                      { lat: deParkLat, lng: deParkLng },
                      { lat: pt.lat, lng: pt.lng },
                    ),
                  );
          }
        }
        buffer.push(pt);
        if (buffer.length > MAX_BUFFER) {
          const capped = capBuffer(buffer, MAX_BUFFER);
          trackerDiag.evictedPoints += capped.evicted;
          buffer = capped.points;
        }
        persistBuffer();
        if (buffer.length >= FLUSH_AT_POINTS) void flush();
        // A point arrived, so this page life is genuinely capturing.
        // Guarantee it is also reporting: see ensureHeartbeatTimer.
        ensureHeartbeatTimer();
      },
    );
    tracking = true;
    trackerDiag.startResult = "resolved";
    // Arm completed: the service is back up, so the latch has nothing
    // left to prove. Cleared here rather than in a finally, because the
    // catch path below genuinely DID leave the tracker stopped and the
    // latch should survive to say so.
    try {
      window.localStorage.removeItem(LS_ARMING);
    } catch {
      /* private mode */
    }
    for (const cb of startListeners) {
      try {
        cb({ ok: true });
      } catch {
        /* listener threw, keep going */
      }
    }
    // Web shim only (NEVER touch .then on the native bridge): surface a
    // late start rejection so the browser toggle flips back off.
    if (
      !trackerDiag.native &&
      startRet &&
      typeof (startRet as Promise<void>).then === "function"
    ) {
      void Promise.resolve(startRet).catch((e) => {
        trackerDiag.startResult = "rejected";
        trackerDiag.startError = String(
          (e && (e.message || e.code)) || e || "unknown",
        ).slice(0, 80);
        tracking = false;
        try {
          window.localStorage.setItem(LS_ENABLED, "0");
        } catch {
          /* private mode */
        }
        for (const cb of startListeners) {
          try {
            cb({ ok: false, error: trackerDiag.startError });
          } catch {
            /* listener threw, keep going */
          }
        }
      });
    }
  } catch (e) {
    tracking = false;
    return {
      ok: false,
      error: e instanceof Error ? e.message : "start_failed",
    };
  }

  if (!flushTimer) {
    flushTimer = setInterval(() => {
      void flush();
      // Close a finished drive promptly (walked-away / parked) instead of
      // waiting out the server's 5-min timer.
      void maybeCloseDrive();
      // Heartbeat has its own timer now (ensureHeartbeatTimer), so it no
      // longer depends on this interval running at all.
    }, FLUSH_EVERY_MS);
    ensureHeartbeatTimer();
    void sendHeartbeat();
    // Instant permission-downgrade reaction (plan §C): the native
    // plugin fires the moment iOS silently drops Always → While Using.
    // Set the blocked flag (drives the non-dismissible banner), tell
    // the server NOW via heartbeat, and let the reminder UI refresh.
    void (async () => {
      try {
        const { onAuthorizationChanged } = await import(
          "@/lib/mileage/device-status"
        );
        authUnsub?.();
        authUnsub = await onAuthorizationChanged((auth) => {
          if (auth === "always") {
            try {
              localStorage.removeItem(LS_PERM);
            } catch { /* private mode */ }
          } else {
            try {
              localStorage.setItem(LS_PERM, "1");
            } catch { /* private mode */ }
          }
          window.dispatchEvent(new Event("taxottic:mileage-perm"));
          void sendHeartbeat();
        });
      } catch {
        /* plugin absent */
      }
    })();
    if (watchdogTimer) clearInterval(watchdogTimer);
    trackerDiag.lastCbAt = Date.now(); // arm from "now", not from 0
    watchdogLastTickAt = Date.now();
    watchdogTimer = setInterval(() => {
      if (!tracking || watchdogRearming) return;
      // Self-check FIRST: did our own timer actually run on schedule?
      //
      // This used to be `if (document.visibilityState !== "visible")
      // return`, which made the watchdog unable to fire in the one
      // situation it exists for. The zombie it hunts (Samsung "Sleeping
      // apps" and friends killing the foreground GPS service while the
      // WebView process survives) happens WHILE THE APP IS
      // BACKGROUNDED. By the time the app is visible again,
      // resumeMileageTrackingIfEnabled() has already re-armed on the
      // appStateChange/resume listeners, so the visible-only watchdog
      // could only ever run when there was nothing left to fix.
      //
      // The reason behind the old gate was real, though: a throttled or
      // suspended WebView timer makes `now - lastCbAt` look enormous
      // without proving anything about the watcher. Test that directly
      // instead of using visibility as a proxy. A tick that arrives on
      // schedule proves our timers are running, which makes the silence
      // it measures real evidence, backgrounded or not. A late tick
      // proves only that WE were asleep, so re-baseline and wait for
      // clean evidence.
      const tickAt = Date.now();
      const sinceTick = tickAt - watchdogLastTickAt;
      watchdogLastTickAt = tickAt;
      if (sinceTick > WATCHDOG_THROTTLE_TICK_MS) {
        trackerDiag.lastCbAt = tickAt;
        return;
      }
      const silentMs = tickAt - trackerDiag.lastCbAt;
      if (silentMs < WATCHDOG_STALL_MS) return;
      if (trackerDiag.watchdogRestarts >= WATCHDOG_MAX_RESTARTS) return;
      trackerDiag.watchdogRestarts++;
      watchdogRearming = true;
      void (async () => {
        try {
          await stopMileageTracking({ keepEnabled: true });
          await startMileageTracking(companyId);
        } catch {
          /* next watchdog tick tries again, bounded by MAX_RESTARTS */
        } finally {
          watchdogRearming = false;
        }
      })();
    }, WATCHDOG_TICK_MS);
  }
  return { ok: true };
}

/** Stop tracking, flush whatever is buffered, forget the preference. */
export async function stopMileageTracking(
  opts?: {
    /** Watchdog re-arm: bounce the native watcher WITHOUT flipping the
     *  user's enabled preference off (a plain stop is a user intent;
     *  a re-arm is not). */
    keepEnabled?: boolean;
  },
): Promise<void> {
  if (!opts?.keepEnabled) {
    try {
      window.localStorage.removeItem(LS_ENABLED);
      void setBackgroundRevival(false, "");
      void setExitBreadcrumb("tracking=off");
    } catch {
      /* ignore */
    }
  }
  if (flushTimer) {
    clearInterval(flushTimer);
    if (watchdogTimer) {
      clearInterval(watchdogTimer);
      watchdogTimer = null;
    }
    flushTimer = null;
  }
  const bg = await guard();
  if (bg && tracking) {
    await stopBgSafely(bg);
  }
  tracking = false;
  void sendHeartbeat();
  // Final upload tagged sessionEnded so the server force-closes any
  // in-progress trip immediately (the user explicitly stopped). This
  // is the only thing that materializes a drive that ended without a
  // 5-min stationary dwell, i.e. nearly every real drive, where you
  // park and immediately toggle off.
  await flush({ sessionEnded: true }); // best-effort final upload
}

/** UI snapshot for the "Location must be Always" banner. `enabled` is
 *  the user's tracking intent; `permBlocked` is set once the watcher has
 *  reported a permission failure. */
export function getMileageTrackingUiState(): {
  enabled: boolean;
  permBlocked: boolean;
} {
  if (typeof window === "undefined") {
    return { enabled: false, permBlocked: false };
  }
  try {
    return {
      enabled: window.localStorage.getItem(LS_ENABLED) === "1",
      permBlocked: window.localStorage.getItem(LS_PERM) === "1",
    };
  } catch {
    return { enabled: false, permBlocked: false };
  }
}

/** Open the OS location-settings screen for this app. Prefers our
 *  TaxotticDeviceStatus plugin, which deep-links straight to the app's
 *  Location permission page (Android) / Settings page (iOS); falls back
 *  to the Capgo plugin's openSettings (which only reaches the generic
 *  App-info page) when our plugin isn't in this binary. */
export async function openMileageLocationSettings(): Promise<void> {
  try {
    const { openLocationSettingsPrecise } = await import(
      "@/lib/mileage/device-status"
    );
    if (await openLocationSettingsPrecise()) return;
  } catch {
    /* device-status plugin absent — fall through to Capgo openSettings */
  }
  const bg = await guard();
  try {
    await (bg as { openSettings?: () => Promise<void> } | null)?.openSettings?.();
  } catch {
    /* openSettings unavailable in this binary */
  }
}

/** Re-arm tracking after the user fixes the permission (banner action).
 *  Reuses the saved company; startMileageTracking re-requests permission
 *  and, on the first successful fix, clears the permBlocked flag. */
export async function retryMileageTracking(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (typeof window === "undefined") return { ok: false };
  let company = "";
  try {
    company = window.localStorage.getItem(LS_COMPANY) ?? "";
  } catch {
    /* private mode */
  }
  if (!company) return { ok: false, error: "no_company" };
  return startMileageTracking(company);
}

/**
 * Re-arm tracking on app launch if the user had it on. Called from
 * the app-wide native init. Also flushes any points a previous
 * session left buffered (e.g. the app was killed mid-drive).
 */
export async function resumeMileageTrackingIfEnabled(): Promise<void> {
  if (typeof window === "undefined") return;
  let enabled = false;
  let savedCompany = "";
  try {
    enabled = window.localStorage.getItem(LS_ENABLED) === "1";
    savedCompany = window.localStorage.getItem(LS_COMPANY) ?? "";
  } catch {
    return;
  }
  if (!enabled || !savedCompany) return;
  // App start is one of the two moments the app is genuinely
  // foregrounded (the other is appStateChange isActive). Capture device
  // truth now, while the bridge demonstrably answers.
  installAppStateWatch();
  void refreshDeviceStatusCache().catch(() => {});
  loadPersistedBuffer();
  companyId = savedCompany;
  void flush(); // drain a killed-mid-drive leftover
  // Upload whatever the NATIVE layer captured while this page was not
  // alive — on iOS that is the entire morning commute after an
  // overnight termination. Late points are fine: the finalizer runs a
  // 45-day window and reconciles, so the trip still materialises
  // correctly. Buffer is cleared only after the server accepts.
  void drainNativeLocationBuffer().then((n) => {
    if (n > 0) trackerDiag.nativeDrained = n;
  });
  // Re-arm native revival too: a reinstall or a permission change can
  // leave the flag set with SLC not actually registered.
  void setBackgroundRevival(true, savedCompany);
  // ANDROID GEOFENCE RESURRECTION NET (lib/mileage/geofence.ts).
  //
  // Same job as the iOS drain above, different mechanism. If the OS
  // killed us overnight and a learned-place geofence exit restarted
  // capture this morning, that drive is sitting in a native disk
  // buffer, because the @capgo plugin discards every fix whose saved
  // PluginCall is gone. Upload it, then tell the native capture to
  // stand down now that the WebView watcher is about to take over:
  // two location foreground services is double battery for one stream.
  void drainGeofenceBuffer(savedCompany).then((n) => {
    if (n > 0) trackerDiag.geofenceDrained = n;
    return stopGeofenceCapture();
  });
  // Re-sync the mesh on every resume, not once. A permission change, a
  // reinstall, or Play services clearing its geofence table all leave
  // us believing we are armed with nothing registered, and none of
  // those is observable from here.
  void syncLearnedPlaces(savedCompany).then((r) => {
    trackerDiag.geofenceSynced = r.synced;
    trackerDiag.geofenceArmState = r.armState;
  });
  // Always re-verify/re-arm here, ignoring the in-memory `tracking` flag.
  // That flag only reflects whether OUR code called bg.start(), it stays
  // true even when Android (esp. Samsung's "Sleeping apps" battery
  // optimization) silently kills the underlying foreground GPS service
  // while the WebView process itself survives. Trusting the stale flag
  // meant resume-on-launch/resume-on-foreground was a no-op forever after
  // the OS killed the service, which is exactly the "tracker hasn't
  // logged in a while" bug (confirmed live: /mileage/diagnose showed the
  // native service reporting ALREADY_STARTED, i.e. genuinely running,
  // while zero fixes had landed in days, the callback attached to it was
  // orphaned). Resetting `tracking` forces startMileageTracking's existing
  // stop-then-start dance to run every resume, which rebuilds a fresh
  // subscription with a live callback whether or not the flag was honest.
  tracking = false;
  await startMileageTracking(savedCompany);
}

/** Open the OS location-settings screen so the user can flip Location to
 *  "Always" (the only way background drive-capture works). Prefers our
 *  TaxotticDeviceStatus deep-link to the Location permission page, then
 *  falls back to the Capgo plugin's coarser openSettings. No-ops off
 *  native. Never awaits `.then` on the native proxy (see stopBgSafely). */
export async function openLocationSettings(): Promise<void> {
  try {
    const { openLocationSettingsPrecise } = await import(
      "@/lib/mileage/device-status"
    );
    if (await openLocationSettingsPrecise()) return;
  } catch {
    /* device-status plugin absent — fall through to Capgo openSettings */
  }
  const bg = await guard();
  if (!bg) return;
  try {
    void bg.openSettings();
  } catch {
    /* not available on this build, the on-screen steps still guide the user */
  }
}

/** Snapshot for the UI toggle. `supported` is true only on the
 *  native shell with the plugin in the running binary. */
export async function getMileageTrackingState(): Promise<TrackingState> {
  let enabled = false;
  try {
    enabled = window.localStorage.getItem(LS_ENABLED) === "1";
  } catch {
    /* ignore */
  }
  const bg = await guard();
  return { supported: !!bg, enabled };
}
