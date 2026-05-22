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

// Battery vs. fidelity. The segmentation core tolerates sparse points
// (it derives speed/dwell from gaps), so a 25 m filter is plenty for
// trip detection and keeps the GPS duty cycle low.
const DISTANCE_FILTER_M = 25;
// Flush when either threshold trips. Frequent enough that a force-kill
// loses little; the server de-dupes re-posted batches.
const FLUSH_AT_POINTS = 40;
const FLUSH_EVERY_MS = 120_000;
// Hard cap so a stuck network can't grow localStorage unbounded.
const MAX_BUFFER = 5_000;

type TrackingState = { supported: boolean; enabled: boolean };

let plugin: BackgroundGeolocationPlugin | null = null;
let tracking = false;
let buffer: GpsPoint[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let flushing = false;
let companyId = "";

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
};

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
 *  on failure (retry next tick); drops only what the server accepted. */
async function flush(): Promise<void> {
  if (flushing) return;
  if (!companyId || buffer.length < 2) return;
  flushing = true;
  const batch = buffer.slice(0, MAX_BUFFER);
  try {
    const res = await fetch("/api/mileage/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ companyId, points: batch }),
      keepalive: true,
    });
    if (res.ok) {
      buffer = buffer.slice(batch.length);
      persistBuffer();
    }
  } catch {
    /* offline / transient — keep the batch for the next flush */
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
  const bg = await guard();
  if (!bg) return { ok: false, error: "unavailable" };
  if (tracking) return { ok: true };

  companyId = forCompanyId;
  try {
    window.localStorage.setItem(LS_ENABLED, "1");
    window.localStorage.setItem(LS_COMPANY, forCompanyId);
  } catch {
    /* private mode — tracking still works for this session */
  }
  loadPersistedBuffer();

  // Fire-and-forget start(). On the Galaxy Z Fold5 (and likely
  // other Samsung WebViews), bg.start()'s returned promise hangs
  // until the foreground service is fully up AND the first GPS
  // fix arrives, which can take 10+ seconds. Awaiting it leaves
  // the toggle in a permanent "loading" state with no user
  // feedback. We flip the tracking flag optimistically and let
  // the callback handle errors — if NOT_AUTHORIZED comes back,
  // stopMileageTracking() resets the flag. UX: toggle responds
  // instantly; foreground-service notification appears within a
  // few seconds when the OS gets the service up.
  try {
    bg
      .start(
        {
          // Presence of backgroundMessage is what enables background
          // delivery; on Android it is the persistent-notification text
          // the OS requires for a location foreground service.
          backgroundMessage:
            "Logging your drive for the mileage deduction. Tap to open.",
          backgroundTitle: "Taxottic mileage",
          requestPermissions: true,
          stale: false,
          distanceFilter: DISTANCE_FILTER_M,
        },
        (location, error) => {
          if (error) {
            // NOT_AUTHORIZED → the user denied/revoked location. Stop
            // cleanly and drop the preference so we don't nag forever.
            if (error.code === "NOT_AUTHORIZED")
              void stopMileageTracking();
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
      )
      .catch(() => {
        // start() threw — the plugin reported an error before
        // even registering the callback. Stop cleanly so the next
        // tap can retry from a clean state.
        tracking = false;
        try {
          window.localStorage.setItem(LS_ENABLED, "0");
        } catch {
          /* private mode */
        }
      });
    tracking = true;
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
    try {
      await bg.stop();
    } catch {
      /* already stopped */
    }
  }
  tracking = false;
  await flush(); // best-effort final upload
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
  if (!tracking) await startMileageTracking(savedCompany);
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
