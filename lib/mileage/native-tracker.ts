// Phase 4 — native background drive capture (client side).
//
// The device's ONLY job is to stream raw GPS points to
// /api/mileage/ingest. Every bit of intelligence (trip segmentation,
// classification, IRS deduction) is server-side and already unit-
// tested — see docs/MILEAGE_TRACKER_SPEC.md. So this module is
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
// predates this plugin, it is absent — every entry point guards on
// isNativePlatform() + isPluginAvailable("BackgroundGeolocation")
// and no-ops cleanly so the /mileage page still renders.

import type { GpsPoint } from "./segmentation";

// Minimal contract for the slice of @capgo/background-geolocation we
// use. Declared locally (rather than importing the package's types at
// module scope) so nothing from the native plugin is pulled into the
// web bundle's static graph — the package is only ever reached through
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

// Battery vs. fidelity. The segmentation core tolerates sparse points
// (it derives speed/dwell from gaps), so a 25 m filter is plenty for
// trip detection and keeps the GPS duty cycle low.
//
// Eco mode bumps this to 100 m (only emit a fix when the user has
// actually moved 100 m). On a Samsung the OS-fused provider sleeps
// the GPS sensor between fixes — net effect is roughly 4× less
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
// drive is happening — the previous cadence meant a 4-minute drive
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
 *  user's phone with ZERO points ever reaching the server — proven on
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
 *  where guard() finished at ~5–6 s on a cold start but
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
let flushing = false;
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
  // Last result from startMileageTracking() — set when the native
  // bg.start() promise settles. Surfaced in the UI diag so we can
  // see the actual native return path without DevTools.
  startResult: "untouched" as string,
  startError: "" as string,
  cbHits: 0 as number,
  cbLastError: "" as string,
  // Last flush round-trip — populated by flush() so the toggle UI
  // can show "the device IS reaching the server" or "the device
  // sent 40 points and got 401 back" without DevTools.
  flushCount: 0 as number,
  flushLastStatus: 0 as number,
  flushLastResult: "" as string,
  flushLastTripsCreated: 0 as number,
  flushLastStagingLeft: 0 as number,
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
      // Package not in this bundle / native side absent — clean no-op.
      trackerDiag.lastError = `capgo import: ${String(e)}`;
      return null;
    }
  }
  return plugin;
}

/**
 * Stop the native watcher WITHOUT awaiting on Android.
 *
 * On Android the @capgo plugin's stop() — like start() — is callback-
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
    /* no active session / already stopped — fine */
  }
}

function persistBuffer() {
  try {
    window.localStorage.setItem(LS_BUFFER, JSON.stringify(buffer));
  } catch {
    /* quota / disabled — in-memory buffer still flushes */
  }
}

function loadPersistedBuffer() {
  try {
    const raw = window.localStorage.getItem(LS_BUFFER);
    if (!raw) return;
    const parsed = JSON.parse(raw) as GpsPoint[];
    if (Array.isArray(parsed)) buffer = parsed.slice(-MAX_BUFFER);
  } catch {
    /* corrupt — drop it */
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
async function flush(opts?: { sessionEnded?: boolean }): Promise<void> {
  const sessionEnded = opts?.sessionEnded === true;
  if (flushing) return;
  if (!companyId) return;
  // Allow heartbeat (buffer.length === 0) WHILE tracking is active so
  // the server keeps re-segmenting staging. If we're not tracking and
  // the buffer is empty, nothing to do — UNLESS this is the
  // session-end flush, which must reach the server even with an empty
  // buffer so the server force-closes the in-progress trip (see the
  // sessionEnded handling in /api/mileage/ingest). Without this
  // override, toggling off after a drive whose last points already
  // flushed would never close the trip — it would sit open forever.
  if (buffer.length < 1 && !tracking && !sessionEnded) return;
  flushing = true;
  trackerDiag.flushCount++;
  // Cap the batch (see FLUSH_BATCH_MAX). NEVER use keepalive here: its
  // 64 KB body limit silently breaks every flush once the buffer is
  // non-trivial. A large backlog drains over successive ticks.
  const batch = buffer.slice(0, FLUSH_BATCH_MAX);
  try {
    const res = await fetch("/api/mileage/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ companyId, points: batch, sessionEnded }),
    });
    trackerDiag.flushLastStatus = res.status;
    let bodyJson: unknown = null;
    try {
      bodyJson = await res.clone().json();
    } catch {
      /* not JSON — leave as null */
    }
    if (res.ok) {
      // Server staged everything; drop locally so we don't re-send
      // the same points. The server's staging table is authoritative
      // for "did this point land" — we trust the 2xx.
      buffer = buffer.slice(batch.length);
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
    } else {
      // KEEP the batch on non-2xx so we retry next tick. Surface the
      // status + first ~40 chars of the body so the UI diag line can
      // show "401 unauthorized" instead of silently failing forever
      // (the bug we shipped for months before May 25).
      const errBody = bodyJson
        ? JSON.stringify(bodyJson).slice(0, 60)
        : (await res.clone().text().catch(() => "")).slice(0, 60);
      trackerDiag.flushLastResult = `${res.status} ${errBody}`;
    }
  } catch (e) {
    // Offline / transient — keep the batch. Surface the error type
    // (TypeError = network unreachable; AbortError = timed out).
    trackerDiag.flushLastResult = `network: ${
      e instanceof Error ? e.name + ":" + e.message.slice(0, 40) : "unknown"
    }`;
  } finally {
    flushing = false;
  }
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
 * so resumeMileageTrackingIfEnabled() can re-arm on a cold start —
 * the plugin's tracking session does NOT survive a process kill.
 */
export async function startMileageTracking(
  forCompanyId: string,
): Promise<{ ok: boolean; error?: string }> {
  trackerDiag.startResult = "entered";
  // Prefer the cached plugin; if not yet loaded, AWAIT guardWithTimeout
  // so the first tap actually starts tracking instead of silently
  // returning "warming" and requiring a second tap. Capped at
  // GUARD_TIMEOUT_MS so a stuck dynamic import doesn't block forever.
  //
  // RACE RECOVERY (2026-05-26): a real-device diag line showed
  // `plug=true imp=true start=true call=unsupported err=guard_timeout`.
  // guardWithTimeout's 5s timeout fired BEFORE guard() finished, so
  // `bg` was null at the await boundary — but guard() finished a few
  // hundred ms later and cached `plugin = bg`. The previous error
  // branch then read a stale `plugin === null` and reported unsupported.
  // Fix: after the await, re-check the module-level `plugin` cache.
  // If guard() finished during our timeout window, grab it now and
  // continue normally. Saves the user from having to tap the toggle
  // twice on a slow first cold-start.
  let bg = plugin ?? (await guardWithTimeout());
  if (!bg && plugin) {
    // guard() raced past the timeout — use the cached ref.
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
    window.localStorage.setItem(LS_COMPANY, forCompanyId);
  } catch {
    /* private mode — tracking still works for this session */
  }
  loadPersistedBuffer();

  // CRITICAL (2026-05-26): always call bg.stop() before bg.start() to
  // kill any orphaned foreground service from a previous WebView
  // session.
  //
  // Real-world failure: user drove, server received zero points across
  // the entire drive. Diag showed cbErr=ALREADY_STARTED. Root cause:
  // when Android kills the JS process but the @capgo foreground
  // service survives (which it does — that's the whole point of a
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
    /* private mode — default to full fidelity */
  }
  const distanceFilter = eco
    ? DISTANCE_FILTER_M_ECO
    : DISTANCE_FILTER_M_DEFAULT;
  try {
    // CRITICAL (2026-06-01 on-device forensics, Galaxy Z Fold5):
    // bg.start(options, callback) is a CALLBACK method, not a Promise
    // method, on Android. Its return value is NOT a thenable — calling
    // `.then()` on it proxies to a native method literally named "then"
    // that doesn't exist, throwing
    //   `"BackgroundGeolocation.then()" is not implemented on android`.
    // The old `.start(...).then(...).catch(...)` chain therefore tripped
    // the rejection path on EVERY start — flipping tracking off and
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
        // deduction (derived point-to-point) are unaffected — only the
        // exact timestamp of a fix can lag a beat. Eco mode still layers
        // the bigger 100 m distanceFilter saving on top of this.
        stale: true,
        distanceFilter,
      },
      (location, error) => {
        trackerDiag.cbHits++;
        if (error) {
          trackerDiag.cbLastError =
            String(error.code ?? "") + ":" + String(error.message ?? "");
          if (error.code === "NOT_AUTHORIZED") void stopMileageTracking();
          return;
        }
        if (!location) return;
        const pt = toPoint(location);
        if (!pt) return;
        buffer.push(pt);
        if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
        persistBuffer();
        if (buffer.length >= FLUSH_AT_POINTS) void flush();
      },
    );
    tracking = true;
    trackerDiag.startResult = "resolved";
    for (const cb of startListeners) {
      try {
        cb({ ok: true });
      } catch {
        /* listener threw — keep going */
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
            /* listener threw — keep going */
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
    flushTimer = setInterval(() => void flush(), FLUSH_EVERY_MS);
  }
  return { ok: true };
}

/** Stop tracking, flush whatever is buffered, forget the preference. */
export async function stopMileageTracking(): Promise<void> {
  try {
    window.localStorage.removeItem(LS_ENABLED);
  } catch {
    /* ignore */
  }
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  const bg = await guard();
  if (bg && tracking) {
    await stopBgSafely(bg);
  }
  tracking = false;
  // Final upload tagged sessionEnded so the server force-closes any
  // in-progress trip immediately (the user explicitly stopped). This
  // is the only thing that materializes a drive that ended without a
  // 5-min stationary dwell — i.e. nearly every real drive, where you
  // park and immediately toggle off.
  await flush({ sessionEnded: true }); // best-effort final upload
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
  loadPersistedBuffer();
  companyId = savedCompany;
  void flush(); // drain a killed-mid-drive leftover
  // Always re-verify/re-arm here, ignoring the in-memory `tracking` flag.
  // That flag only reflects whether OUR code called bg.start() — it stays
  // true even when Android (esp. Samsung's "Sleeping apps" battery
  // optimization) silently kills the underlying foreground GPS service
  // while the WebView process itself survives. Trusting the stale flag
  // meant resume-on-launch/resume-on-foreground was a no-op forever after
  // the OS killed the service, which is exactly the "tracker hasn't
  // logged in a while" bug (confirmed live: /mileage/diagnose showed the
  // native service reporting ALREADY_STARTED, i.e. genuinely running,
  // while zero fixes had landed in days — the callback attached to it was
  // orphaned). Resetting `tracking` forces startMileageTracking's existing
  // stop-then-start dance to run every resume, which rebuilds a fresh
  // subscription with a live callback whether or not the flag was honest.
  tracking = false;
  await startMileageTracking(savedCompany);
}

/** Open the OS app-settings screen so the user can flip Location to
 *  "Always" (the only way background drive-capture works). No-ops off
 *  native. Never awaits `.then` on the native proxy (see stopBgSafely). */
export async function openLocationSettings(): Promise<void> {
  const bg = await guard();
  if (!bg) return;
  try {
    void bg.openSettings();
  } catch {
    /* not available on this build — the on-screen steps still guide the user */
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
