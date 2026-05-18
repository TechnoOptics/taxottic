"use client";

import { useEffect } from "react";

/**
 * Left-edge swipe → go back, for the native shell only.
 *
 * iOS Safari and Android Chrome already have their own edge-back
 * gesture; the Capacitor WKWebView/WebView does NOT — that is exactly
 * why "swipe back" felt missing in the app. So we gate this to the
 * native shell (Capacitor.isNativePlatform()) and stay completely
 * inert on the web, where adding our own would fight the browser's.
 *
 * Deliberately conservative so it never hijacks a normal scroll or a
 * horizontal carousel: the touch must START within 24px of the left
 * edge, be a single finger, travel >64px to the right, stay roughly
 * horizontal, and finish quickly. We never call preventDefault, so
 * vertical scrolling is untouched.
 *
 * No native rebuild needed — this ships with the web bundle and works
 * on the already-installed binary immediately.
 */
export function EdgeSwipeBack() {
  useEffect(() => {
    let active = false;
    let startX = 0;
    let startY = 0;
    let startT = 0;

    const EDGE_PX = 24;
    const MIN_DX = 64;
    const MAX_DY = 44;
    const MAX_MS = 600;

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        active = false;
        return;
      }
      const t = e.touches[0];
      if (t.clientX <= EDGE_PX) {
        active = true;
        startX = t.clientX;
        startY = t.clientY;
        startT = Date.now();
      } else {
        active = false;
      }
    };

    const onEnd = (e: TouchEvent) => {
      if (!active) return;
      active = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      const dt = Date.now() - startT;
      if (
        dx > MIN_DX &&
        Math.abs(dy) < MAX_DY &&
        dx > Math.abs(dy) * 1.5 &&
        dt < MAX_MS &&
        window.history.length > 1
      ) {
        window.history.back();
      }
    };

    let detach: (() => void) | null = null;

    (async () => {
      if (typeof window === "undefined") return;
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
      } catch {
        return;
      }
      document.addEventListener("touchstart", onStart, { passive: true });
      document.addEventListener("touchend", onEnd, { passive: true });

      // Android's system back GESTURE/button reaches Capacitor as
      // `backButton`; the default behaviour is to exit the app
      // instantly — which is why "swipe to go back" felt broken on
      // Android. Route it through history so it behaves like every
      // other app, only exiting when there's nowhere left to go.
      let removeBack: (() => void) | null = null;
      try {
        const { App } = await import("@capacitor/app");
        const h = await App.addListener("backButton", ({ canGoBack }) => {
          if (canGoBack || window.history.length > 1) {
            window.history.back();
          } else {
            void App.exitApp();
          }
        });
        removeBack = () => void h.remove();
      } catch {
        /* @capacitor/app absent in this binary — edge swipe still works */
      }

      detach = () => {
        document.removeEventListener("touchstart", onStart);
        document.removeEventListener("touchend", onEnd);
        removeBack?.();
      };
    })();

    return () => {
      detach?.();
    };
  }, []);

  return null;
}
