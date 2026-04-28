"use client";

import { useEffect, useState } from "react";

type DeferredPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Mounted once at the root layout. Two jobs:
 * 1. Register the service worker so the app installs as a PWA on iOS/Android/desktop.
 * 2. Catch the `beforeinstallprompt` event and surface a small "Install Taxottic"
 *    button. iOS does not fire this event - on iOS we show a tooltip telling
 *    the user to use Share -> Add to Home Screen.
 */
export function PWASetup() {
  const [deferred, setDeferred] = useState<DeferredPrompt | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Service worker registration
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Fail silently; SW is progressive enhancement
      });
    }

    // Already installed?
    const standalone =
      window.matchMedia?.("(display-mode: standalone)").matches ||
      // iOS Safari
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window.navigator as any).standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }

    // iOS does not support beforeinstallprompt; detect and offer the hint.
    const ua = window.navigator.userAgent.toLowerCase();
    const isIos = /iphone|ipad|ipod/.test(ua) && !/crios|fxios/.test(ua);
    if (isIos) {
      // Show after a short delay so it's not aggressive on first load
      const t = setTimeout(() => {
        const dismissed = localStorage.getItem("taxottic.iosInstallDismissed");
        if (!dismissed) setShowIosHint(true);
      }, 8000);
      return () => clearTimeout(t);
    }

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferred(e as DeferredPrompt);
    };
    const onAppInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  if (installed) return null;

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
