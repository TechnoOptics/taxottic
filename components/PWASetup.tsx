"use client";

import { useEffect, useRef, useState } from "react";
import { ensureWebPushSubscribed } from "@/lib/push/web";
import { shouldAdoptWaitingWorker } from "@/lib/pwa/adopt-policy";

type DeferredPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Mounted once at the root layout. Three jobs:
 * 1. Register the service worker so the app installs as a PWA on iOS/Android/desktop.
 * 2. Catch the `beforeinstallprompt` event and surface a small "Install Taxottic"
 *    button. iOS does not fire this event - on iOS we show a tooltip telling
 *    the user to use Share -> Add to Home Screen.
 * 3. Detect when a new service worker is waiting and show an "Update available"
 *    toast. When the user taps Refresh, post SKIP_WAITING to the waiting SW
 *    and reload as soon as the new SW takes control.
 */
export function PWASetup() {
  const [deferred, setDeferred] = useState<DeferredPrompt | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [waitingWorker, setWaitingWorker] =
    useState<ServiceWorker | null>(null);
  // Hydration safety. The server renders `null` (no waitingWorker, no
  // installed, no deferred prompt, all initial state is falsey). The
  // SW-registration effect below can synchronously promote those to
  // truthy on the first client tick, e.g. when a service worker is
  // already waiting after a deploy, or when the PWA is opened in
  // standalone mode. If the first paint of this component differs
  // from the SSR HTML, React throws Minified React error #418 (the
  // May 2026 audit found this on /c/{id}/forecast). Gate every
  // branch on a one-shot `mounted` flag so the SSR/initial-client
  // render is always `null`, and toasts only appear AFTER hydration.
  const [mounted, setMounted] = useState(false);
  // True inside the Capacitor native shell. The whole "Install
  // Taxottic" / iOS "Add to Home Screen" prompt is nonsensical there
  //, the user is already in the installed app. Suppress all
  // install UI when native (the SW "Refresh" update toast still
  // applies because the shell loads the remote site).
  const [isNative, setIsNative] = useState(false);
  // One-shot latch so a single page life can only ever adopt one waiting
  // worker. Adopting posts SKIP_WAITING, which fires controllerchange,
  // which reloads. Without the latch a repeated adopt could reload-loop.
  // A reload starts a fresh page life anyway, so this never blocks a real
  // second update.
  const adopted = useRef(false);
  useEffect(() => {
    setMounted(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cap = (window as any).Capacitor;
      if (cap?.isNativePlatform?.() === true) setIsNative(true);
    } catch {
      /* not in a Capacitor context */
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let reg: ServiceWorkerRegistration | undefined;

    async function registerSW() {
      if (!("serviceWorker" in navigator)) return;
      try {
        reg = await navigator.serviceWorker.register("/sw.js");

        // Adopt a waiting worker instead of waiting for a tap.
        //
        // Why this changed: the old flow ONLY ever adopted on a tap of the
        // "New version" toast. For a background drive tracker that is the
        // wrong default, and it bit us for real. The fix that finally let
        // the geofence mesh arm sat live in production for hours while the
        // affected phone kept running the broken bundle, because nobody
        // knew there was a toast to tap. A fix that cannot reach the device
        // is not a fix.
        //
        // NEVER ADOPT WHILE HIDDEN (regression fix, 2026-08-08).
        //
        // Adopting posts SKIP_WAITING, which fires controllerchange, which
        // reloads the page. The original version of this code did that while
        // the page was hidden, on the reasoning that a reload the user cannot
        // see costs them nothing. On a phone that is tracking a drive it costs
        // the whole drive, because the tracker is armed from this page:
        // native-tracker's arm path calls `await stopBgSafely(bg)` to kill any
        // orphaned service BEFORE `bg.start()`. A fresh page life booting in a
        // backgrounded iOS WebView therefore stops the live background service
        // first, and iOS suspends the WebView's JS at that await, so start()
        // never runs. Tracking is left off until the user next opens the app.
        //
        // Observed: Grace's iPhone logged 284 background heartbeats on 1.3.6,
        // then exactly one on 1.3.7 (the release carrying this code) before
        // going silent for four days. Every contact since has been foreground
        // only, in bursts of 2 to 5 points, which is the signature of a tracker
        // that only ever arms while she is looking at the screen.
        //
        // So: adoption is gated on the page being visible. A worker that
        // installs while hidden simply stays waiting, and onResume below takes
        // it the moment the app comes forward. That keeps the property #484
        // was built for (a fix reaches the device without anyone tapping a
        // toast) while never tearing down the tracker behind the user's back.
        const adopt = (w: ServiceWorker | null | undefined) => {
          if (
            !shouldAdoptWaitingWorker({
              visibility: document.visibilityState,
              alreadyAdopted: adopted.current,
              hasWaitingWorker: Boolean(w),
            })
          )
            return;
          adopted.current = true;
          w!.postMessage({ type: "SKIP_WAITING" });
        };

        // Cold start: a worker left waiting by a previous session.
        if (reg.waiting) adopt(reg.waiting);

        // When an update is found, watch its install state.
        reg.addEventListener("updatefound", () => {
          const newWorker = reg?.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // Hidden: leave it waiting. adopt() would refuse anyway, but
              // being explicit here keeps the reason next to the decision.
              // onResume takes it on the next foreground.
              if (document.visibilityState === "hidden") return;
              // Visible and mid-session: ask, do not seize.
              setWaitingWorker(newWorker);
            }
          });
        });

        // Resume: check for a new version and take it. Covers the native
        // shell returning from background, which is the case that matters
        // here since the app is a WebView on a remote URL.
        const onResume = () => {
          if (document.visibilityState !== "visible") return;
          reg
            ?.update()
            .then(() => adopt(reg?.waiting))
            .catch(() => {});
        };
        document.addEventListener("visibilitychange", onResume);

        // Once the new SW takes control (after we post SKIP_WAITING), reload
        // so the page picks up the new build.
        let reloading = false;
        navigator.serviceWorker.addEventListener("controllerchange", () => {
          if (reloading) return;
          reloading = true;
          window.location.reload();
        });

        // Periodic check for updates while the tab is open. Cheap.
        const interval = setInterval(() => {
          reg?.update().catch(() => {});
        }, 60_000);
        // Also check when the tab regains focus.
        const onFocus = () => reg?.update().catch(() => {});
        window.addEventListener("focus", onFocus);

        // Clean up on unmount (StrictMode double-mount safety).
        return () => {
          clearInterval(interval);
          window.removeEventListener("focus", onFocus);
          document.removeEventListener("visibilitychange", onResume);
        };
      } catch {
        // SW failures are non-fatal.
      }
    }

    registerSW();

    // Web Push: refresh/create the browser subscription (parity with the
    // native shells' cold-start re-register). Self-guards on config, the
    // enable flag, native shell, and existing notification permission.
    // It never prompts here. A settings toggle calls enableWebPush() from a
    // user gesture to request permission the first time.
    void ensureWebPushSubscribed();

    // Already installed?
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.navigator as any).standalone === true;
    if (standalone) {
      setInstalled(true);
    }

    // Native shell: no install prompts at all. Checked directly
    // (not via the `isNative` state, this effect's closure would
    // capture the stale initial value).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nativeShell = (window as any).Capacitor?.isNativePlatform?.() === true;

    // iOS install hint.
    const ua = window.navigator.userAgent.toLowerCase();
    const isIos =
      !nativeShell &&
      /iphone|ipad|ipod/.test(ua) &&
      !/crios|fxios/.test(ua);
    let iosTimer: ReturnType<typeof setTimeout> | null = null;
    if (isIos && !standalone) {
      iosTimer = setTimeout(() => {
        const dismissed = localStorage.getItem("taxottic.iosInstallDismissed");
        if (!dismissed) setShowIosHint(true);
      }, 8000);
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as DeferredPrompt);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    if (!isIos && !nativeShell) {
      window.addEventListener("beforeinstallprompt", onBeforeInstall);
      window.addEventListener("appinstalled", onAppInstalled);
    }

    return () => {
      if (iosTimer) clearTimeout(iosTimer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  function applyUpdate() {
    if (!waitingWorker) return;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
    // controllerchange listener (above) will reload once the new SW activates.
  }

  // Before hydration completes, render nothing, the SSR-rendered
  // output is also `null`, so first commit cannot mismatch. See the
  // `mounted` comment up top.
  if (!mounted) return null;

  // Update toast takes precedence over install prompts.
  if (waitingWorker) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 max-w-md w-full">
        <div className="card flex items-center gap-3 px-4 py-3 shadow-lg border-gold-300/60">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-forest-900">
              New version available
            </div>
            <div className="text-xs text-ink-muted">
              Refresh to use the latest Taxottic.
            </div>
          </div>
          <button
            onClick={applyUpdate}
            className="btn-primary text-xs h-9 px-3"
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  if (installed) return null;

  // Native shell: never show install / Add-to-Home prompts (the
  // SW "Refresh" toast above already returned earlier if relevant).
  if (isNative) return null;

  if (deferred) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 max-w-md w-full">
        <div className="card flex items-center gap-3 px-4 py-3 shadow-lg">
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-forest-900">
              Install Taxottic
            </div>
            <div className="text-xs text-ink-muted">
              Faster opens, works offline.
            </div>
          </div>
          <button
            onClick={async () => {
              try {
                await deferred.prompt();
                await deferred.userChoice;
              } finally {
                setDeferred(null);
              }
            }}
            className="btn-primary text-xs h-9 px-3"
          >
            Install
          </button>
          <button
            onClick={() => setDeferred(null)}
            aria-label="Dismiss install prompt"
            className="text-xs text-ink-muted hover:text-forest-800 px-2"
          >
            ✕
          </button>
        </div>
      </div>
    );
  }

  if (showIosHint) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 max-w-md w-full">
        <div className="card px-4 py-3 shadow-lg">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-forest-900">
                Add Taxottic to your Home Screen
              </div>
              <div className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                Tap the <span aria-label="Share">Share</span> icon, then{" "}
                <span className="font-medium">Add to Home Screen</span>.
              </div>
            </div>
            <button
              onClick={() => {
                localStorage.setItem("taxottic.iosInstallDismissed", "1");
                setShowIosHint(false);
              }}
              aria-label="Dismiss"
              className="text-xs text-ink-muted hover:text-forest-800 px-2"
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
