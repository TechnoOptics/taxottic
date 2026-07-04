"use client";

import { useEffect, useState } from "react";

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

        // If a worker is already waiting when we register, surface it.
        if (reg.waiting) setWaitingWorker(reg.waiting);

        // When an update is found, watch its install state.
        reg.addEventListener("updatefound", () => {
          const newWorker = reg?.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // A new version is ready, but the current page is still
              // controlled by the old one. Wait for user opt-in.
              setWaitingWorker(newWorker);
            }
          });
        });

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
        };
      } catch {
        // SW failures are non-fatal.
      }
    }

    registerSW();

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
