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
    <div className="border-b border-forest-100 bg-cream/80">
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
