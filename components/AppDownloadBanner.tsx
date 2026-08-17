"use client";

import { useEffect, useState } from "react";
import { useIsNativeApp } from "@/components/MobileOnly";
import { AppStoreBadges } from "@/components/AppStoreBadges";

const DISMISS_KEY = "taxottic-app-banner-dismissed-v1";

/**
 * Slim, dismissible "get the mobile app" banner for the web version of
 * Taxottic. Shows the App Store + Google Play badges. Hidden inside the native
 * Capacitor shell (you're already in the app there) and once dismissed
 * (remembered per device). Returns null until the platform + dismissal state
 * are known so it never flashes in the native app.
 */
export function AppDownloadBanner() {
  const isNative = useIsNativeApp();
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the persisted dismissal
      setDismissed(window.localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // no-op
    }
  }

  // Not on native, not before we know state, not once dismissed.
  if (isNative === null || isNative === true || dismissed === null || dismissed) {
    return null;
  }

  return (
    // FIXED, not in flow, and that is the whole point.
    //
    // This banner cannot know whether to render until after hydration:
    // the dismissal lives in localStorage and the native check is an
    // async import of @capacitor/core, so the server renders nothing
    // and the client decides. In normal flow that means it appears
    // ~118px tall AFTER first paint and shoves the entire page down.
    //
    // Measured 2026-08-10 against a local production build: that single
    // insertion was the home page's ENTIRE Cumulative Layout Shift.
    // Bisected by rebuilding with this component stubbed to null, which
    // took CLS from 0.1304 (0.2608 on some runs) to 0.0000 across three
    // runs with JavaScript otherwise fully enabled. No other page on the
    // site scores above 0.000, and this is the only page that mounts it.
    //
    // Reserving space instead would punish everyone who already
    // dismissed it with a permanent empty gap, and a pre-paint inline
    // script to decide before render risks flashing the banner inside
    // the native shell, which is the one place it must never appear.
    // Taking it out of flow removes the shift by construction: it can
    // now hydrate whenever it likes and move nothing.
    <div
      // bg-[var(--color-cream)]/95, not bg-cream/95: the latter is baked to a
      // literal #fbf7e9 by `@theme inline` and cannot follow the skin, so it
      // laid a warm band across the full width of a cool-paper page.
      className="fixed inset-x-0 bottom-0 z-40 border-t border-forest-100 bg-[var(--color-cream)]/95 backdrop-blur shadow-[0_-8px_24px_-12px_rgba(18,26,42,0.35)]"
      style={{
        // Clear the iOS home indicator. Same expression the rest of the
        // app uses, so this sits correctly in a PWA on a notched phone.
        paddingBottom: "max(var(--safe-bottom, 0px), env(safe-area-inset-bottom, 0px))",
      }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-forest-900 font-medium">
          Taxottic is on your phone too.{" "}
          <span className="text-ink-soft font-normal">
            Track expenses and scan receipts on the go.
          </span>
        </p>
        <div className="flex items-center gap-3">
          <AppStoreBadges />
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss app download banner"
            className="text-ink-muted hover:text-forest-900 text-lg leading-none px-1"
          >
            &times;
          </button>
        </div>
      </div>
    </div>
  );
}
