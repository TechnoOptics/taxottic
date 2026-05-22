"use client";

import { useEffect, useState } from "react";
import {
  startMileageTracking,
  stopMileageTracking,
  getMileageTrackingState,
  trackerDiag,
} from "@/lib/mileage/native-tracker";

type DenialPath = "settings" | "retry";

/**
 * The user-facing on/off for automatic drive logging. Renders on
 * every platform: on the native app it actually arms the background
 * watcher; on web it shows the same control disabled with a short
 * "use the app" note, so the feature is discoverable everywhere. The
 * privacy disclosure is always shown — Apple/Google review and basic
 * good faith both require the purpose to be stated at the toggle.
 */
export function AutoTrackToggle({ companyId }: { companyId: string }) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [denialPath, setDenialPath] = useState<DenialPath | null>(null);
  const [ready, setReady] = useState(false);
  // When the user wants to enable, show an explainer modal BEFORE
  // we call into the native plugin. The OS permission dialog comes
  // up cold otherwise, with no context about why Taxottic is asking.
  // The explainer is dismissable — pressing "Continue" arms the
  // actual start (which triggers the OS dialog); "Cancel" leaves
  // the toggle off.
  const [showExplainer, setShowExplainer] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Lightweight init: just check Capacitor availability + plugin
    // registration (both synchronous once @capacitor/core is in the
    // chunk graph). DO NOT pre-load the @capgo/background-geolocation
    // chunk here — that import has been observed to hang silently
    // on Samsung WebViews after a fresh install, blocking the
    // toggle from ever becoming interactive. We lazy-load it inside
    // start() instead, where any failure is visible to the user.
    //
    // localStorage gives us the persisted "on/off" preference from
    // the last session — we don't need to ask the native side what
    // it thinks; the foreground service either resumed (re-armed on
    // launch via resumeMileageTrackingIfEnabled) or didn't.
    import("@capacitor/core")
      .then(({ Capacitor }) => {
        if (cancelled) return;
        const isSupported =
          Capacitor.isNativePlatform() &&
          Capacitor.isPluginAvailable("BackgroundGeolocation");
        setSupported(isSupported);
        try {
          const persisted =
            window.localStorage.getItem("taxottic.mileage.enabled") === "1";
          setEnabled(persisted);
        } catch {
          /* private mode */
        }
        setReady(true);
      })
      .catch(() => {
        // No Capacitor (pure web) — toggle stays disabled with the
        // "use the mobile app" disclaimer underneath.
        if (cancelled) return;
        setSupported(false);
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Optimistic on/off — the toggle flips IMMEDIATELY when tapped
  // and the native call fires in the background. The previous
  // gated flow (await native, then update React state) made the
  // toggle look broken on any device where bg.start() was slow or
  // hung. UX trade-off: if the native side rejects (denied
  // permission, plugin failure), the visual state may briefly
  // mismatch — but the persistent notification's appearance gives
  // the user the real signal anyway, and on this app's worst
  // platform (Samsung WebView) the awaited path was effectively
  // never resolving. Visible response > invisible correctness.
  const beginStart = () => {
    setShowExplainer(false);
    setError(null);
    setDenialPath(null);
    setEnabled(true);
    try {
      window.localStorage.setItem("taxottic.mileage.enabled", "1");
    } catch {
      /* private mode */
    }
    // Fire-and-forget. If the native side errors, the callback in
    // startMileageTracking handles NOT_AUTHORIZED by calling
    // stopMileageTracking which flips the localStorage flag back.
    startMileageTracking(companyId).catch(() => {
      /* swallow — the toggle stays on visually */
    });
  };

  const onToggle = () => {
    if (enabled) {
      // Turning OFF — flip visually, stop in background.
      setEnabled(false);
      setError(null);
      setDenialPath(null);
      try {
        window.localStorage.setItem("taxottic.mileage.enabled", "0");
      } catch {
        /* private mode */
      }
      stopMileageTracking().catch(() => {
        /* swallow */
      });
      return;
    }
    // Turning ON — show explainer first, then start when user
    // confirms.
    setShowExplainer(true);
  };

  const openAppSettings = () => {
    // Best-effort: launch the OS app-settings via a deep link. On
    // Capacitor we can use the native @capacitor/app's openSettings()
    // but it's not always available across versions; the
    // package:com.taxottic.app deep link works on Android, the
    // "app-settings:" URI on iOS. Try in order; if all fail leave a
    // plain instruction.
    if (typeof window === "undefined") return;
    try {
      // Android intent — Capacitor's WebView understands intent: URIs.
      window.location.href =
        "intent:#Intent;action=android.settings.APPLICATION_DETAILS_SETTINGS;package=com.taxottic.app;end";
      return;
    } catch {
      /* fall through */
    }
    try {
      window.location.href = "app-settings:";
    } catch {
      /* nothing else we can do */
    }
  };

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm font-medium text-forest-900">
            Log my drives automatically
          </div>
          <p className="mt-1 text-xs text-ink-muted leading-relaxed">
            The app detects when you drive and stop, then logs the trip
            so you can mark it business or personal. Location is used
            only to compute your mileage deduction, sent straight to
            your Taxottic account, and never sold or shared. Turn this
            off any time; you can still add drives by hand.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Log my drives automatically"
          onClick={onToggle}
          disabled={busy || !ready || (!supported && !enabled)}
          className={
            "shrink-0 mt-0.5 inline-flex h-6 w-11 items-center rounded-full " +
            "transition-colors disabled:opacity-50 disabled:cursor-not-allowed " +
            (enabled ? "bg-forest-900" : "bg-forest-200")
          }
        >
          <span
            className={
              "inline-block h-5 w-5 transform rounded-full bg-cream " +
              "transition-transform " +
              (enabled ? "translate-x-5" : "translate-x-0.5")
            }
          />
        </button>
      </div>
      {!supported && ready ? (
        <p className="mt-2 text-[11px] text-ink-muted">
          Automatic logging runs in the Taxottic mobile app. On the web
          you can add drives manually below.
        </p>
      ) : null}
      {/* Diagnostic crumb — ALWAYS rendered (not just when
          supported=false) so we can read state even if React's
          ready=false branch was hiding the previous gated version.
          The trackerDiag object is updated by guard() on every
          call, so as soon as getMileageTrackingState resolves —
          even after the 5s timeout — these fields reflect what the
          native shim saw. Removable once toggle is verified. */}
      <p className="mt-1 text-[10px] text-ink-muted font-mono opacity-70">
        diag: ready={String(ready)} sup={String(supported)} en={String(enabled)}
        {" "}native={String(trackerDiag.native)} plug={String(
          trackerDiag.pluginAvailable,
        )} imp={String(trackerDiag.importOk)} start={String(
          trackerDiag.startFn,
        )}
        {trackerDiag.lastError ? ` err=${trackerDiag.lastError.slice(0, 40)}` : ""}
      </p>
      {error ? (
        <div className="mt-2 text-[11px] text-red-700">
          {error}
          {denialPath === "settings" ? (
            <button
              type="button"
              onClick={openAppSettings}
              className="ml-2 underline underline-offset-2 hover:no-underline"
            >
              Open app settings
            </button>
          ) : null}
        </div>
      ) : null}
      {/* Explainer modal — appears between the toggle tap and the
          native OS permission dialog. Without it, users see a cold
          system prompt with no context about why Taxottic is asking
          for Location. */}
      {showExplainer ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Enable mileage tracking"
          className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center"
        >
          <div
            className="absolute inset-0 bg-forest-900/60 backdrop-blur-sm"
            onClick={() => setShowExplainer(false)}
          />
          <div
            className="relative card card-opaque w-full max-w-md m-4 p-6 sm:p-7"
            style={{
              paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))",
            }}
          >
            <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
              Location access
            </div>
            <h3 className="display mt-1 text-xl text-forest-900">
              Log every business drive automatically
            </h3>
            <p className="mt-3 text-sm text-ink-soft leading-relaxed">
              Taxottic uses your phone&apos;s Location to detect when you
              start and stop driving, so the mileage deduction lands in
              your Schedule C without you having to remember.
            </p>
            <ul className="mt-3 grid gap-2 text-[12.5px] text-ink-soft leading-relaxed">
              <li className="flex gap-2">
                <span aria-hidden="true" className="text-gold-700">
                  ✓
                </span>
                <span>
                  Location is used only to compute the deduction —{" "}
                  <span className="font-medium text-forest-900">
                    never sold, never shared.
                  </span>
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden="true" className="text-gold-700">
                  ✓
                </span>
                <span>
                  You can turn it off any time from this screen, no data
                  retained.
                </span>
              </li>
              <li className="flex gap-2">
                <span aria-hidden="true" className="text-gold-700">
                  ✓
                </span>
                <span>
                  Drives still need a one-tap business/personal call from
                  the wrist or the phone deck.
                </span>
              </li>
            </ul>
            <p className="mt-4 text-[11px] text-ink-muted">
              Your phone will ask for permission next. Pick &quot;While
              using the app&quot; (or &quot;Allow all the time&quot; for
              background drives).
            </p>
            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button
                type="button"
                onClick={() => setShowExplainer(false)}
                className="btn-ghost text-sm"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={beginStart}
                className="btn-primary text-sm"
                autoFocus
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
