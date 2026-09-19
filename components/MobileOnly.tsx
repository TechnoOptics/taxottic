"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PhoneIcon } from "@/components/ui/Icons";

/**
 * Module-scope cache of the native check, shared across every mount of
 * `useIsNativeApp` in this process. AppHeader (and therefore TabBar) is
 * rendered per page rather than from a shared layout, so it remounts on
 * every client-side navigation; without this cache `useIsNativeApp`
 * would restart from `null` on each remount and the tab bar would blink
 * out for a frame or more on every tab tap while the dynamic
 * `@capacitor/core` import resolved again. Whether we're native is fixed
 * for the life of the process, so once it's known, later mounts can read
 * it synchronously instead of re-importing.
 *
 * Hydration-safe: this cache is only ever written inside the effect
 * below, and effects never run during server rendering, so the server
 * never mutates it, it stays `null` through every SSR pass. The first
 * client render (before hydration) therefore reads the same `null` a
 * fresh module instance would, matching the server-rendered markup. A
 * client-side navigation, by contrast, renders client components
 * directly with no server render to hydrate against, so reading an
 * already-warm cache there is just a normal re-render with different
 * initial state, not a hydration mismatch.
 */
let nativeKnown: boolean | null = null;

/**
 * True only inside the Capacitor native app (iOS / Android). Returns
 * `null` until it's determined on the client, so SSR and the first
 * paint don't commit to a guess (and the native app never flashes the
 * web fallback before the real control mounts).
 */
export function useIsNativeApp(): boolean | null {
  const [isNative, setIsNative] = useState<boolean | null>(() => nativeKnown);
  useEffect(() => {
    if (nativeKnown !== null) return;
    let cancelled = false;
    import("@capacitor/core")
      .then(({ Capacitor }) => {
        const value = Capacitor.isNativePlatform();
        nativeKnown = value;
        if (!cancelled) setIsNative(value);
      })
      .catch(() => {
        // Deliberately does NOT write `nativeKnown`. The import is a
        // network fetch in the remote-WebView shell and can fail
        // transiently; caching `false` here would wrongly remember a
        // native session as web with no retry, and WebOnly would then
        // render checkout/billing controls inside the native app (App
        // Store 3.1.1). Leave the cache untouched so the next mount
        // tries again.
        if (!cancelled) setIsNative(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return isNative;
}

/**
 * Gate a native-only capability to the Taxottic mobile app. On the
 * native shell it renders {children} (the real control); in a web
 * browser it renders a tasteful "this lives in the app" card instead.
 *
 * Use it for features that depend on native device APIs the website
 * genuinely can't offer, background-location mileage tracking, the
 * paired-watch flow, etc. Beyond the cleaner UX, this is what keeps
 * the iOS app clear of App Store Review Guideline 4.2 (Minimum
 * Functionality): the app visibly does things taxottic.com cannot, so
 * it isn't "just a website in a wrapper."
 */
export function MobileOnly({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const isNative = useIsNativeApp();
  // Undetermined (first client paint): render nothing rather than
  // flash the wrong branch.
  if (isNative === null) return null;
  if (isNative) return <>{children}</>;
  return (
    <div className="card p-4 flex items-start gap-3">
      <PhoneIcon className="size-6 mt-0.5 shrink-0 text-gold-700" />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
          In the mobile app
        </div>
        <div className="mt-0.5 text-sm font-medium text-forest-900">
          {title}
        </div>
        <p className="mt-1 text-xs text-ink-muted leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  );
}
