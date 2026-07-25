"use client";

import { useEffect, useState } from "react";
import { isVersionBelow, MIN_SUPPORTED_NATIVE_VERSION } from "@/lib/version/compare";

/**
 * Persistent "your app is out of date" banner for native shells running a
 * build below MIN_SUPPORTED_NATIVE_VERSION.
 *
 * This is the antidote to the recurring "device stopped tracking" class
 * of incident: the actual fixes ship in new builds, but a phone left on
 * an old build never receives them and its drives quietly stop. A driver
 * on 1.0 has none of the background-tracking reliability work. There is
 * no reliable server-push we can count on for an old build (its push
 * handling may predate our notification code), so the durable signal is
 * in-app and shows the moment they next open Taxottic.
 *
 * Web is unaffected (always current). Non-dismissible on purpose: a stale
 * tracker is silent data loss, which is exactly what we stopped soft-
 * pedalling on the sign-in banner next to it.
 */
export function OutdatedAppBanner() {
  const [outdated, setOutdated] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const isNative =
          (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } })
            .Capacitor?.isNativePlatform?.() === true;
        if (!isNative) return;
        const { App } = await import("@capacitor/app");
        const info = await App.getInfo();
        if (cancelled) return;
        setVersion(info?.version ?? null);
        setOutdated(isVersionBelow(info?.version, MIN_SUPPORTED_NATIVE_VERSION));
      } catch {
        /* not a Capacitor context, or @capacitor/app absent: no banner */
      }
    };
    void check();
    // Re-check on resume: the user may update and come back without a
    // cold start, and the banner should clear itself when they do.
    window.addEventListener("focus", check);
    let removeAppListener = () => {};
    void (async () => {
      try {
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener("resume", check);
        removeAppListener = () => void handle.remove();
      } catch {
        /* absent */
      }
    })();
    return () => {
      cancelled = true;
      window.removeEventListener("focus", check);
      removeAppListener();
    };
  }, []);

  if (!outdated) return null;

  return (
    <div className="mx-4 mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
      <div className="text-sm font-semibold text-amber-900">
        Update Taxottic to keep tracking your drives
      </div>
      <p className="mt-1 text-xs leading-relaxed text-amber-800">
        This phone is running an older version{version ? ` (${version})` : ""}{" "}
        that no longer records drives reliably in the background. Updating to
        the latest version restores automatic mileage tracking.
      </p>
      <a
        href="https://taxottic.com/get"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-3 inline-block rounded-lg bg-amber-900 px-4 py-2 text-xs font-semibold text-amber-50"
      >
        Update now &rarr;
      </a>
    </div>
  );
}
