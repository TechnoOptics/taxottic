"use client";

import { useEffect, useState, type ReactNode } from "react";
import { PhoneIcon } from "@/components/ui/Icons";

/**
 * True only inside the Capacitor native app (iOS / Android). Returns
 * `null` until it's determined on the client, so SSR and the first
 * paint don't commit to a guess (and the native app never flashes the
 * web fallback before the real control mounts).
 */
export function useIsNativeApp(): boolean | null {
  const [isNative, setIsNative] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    import("@capacitor/core")
      .then(({ Capacitor }) => {
        if (!cancelled) setIsNative(Capacitor.isNativePlatform());
      })
      .catch(() => {
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
