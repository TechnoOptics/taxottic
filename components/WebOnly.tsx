"use client";

import { type ReactNode } from "react";
import { useIsNativeApp } from "@/components/MobileOnly";

/**
 * Renders {children} only in a web browser. Inside the native app
 * (the iOS / Android Capacitor shell) it renders {fallback} instead.
 *
 * Inverse of <MobileOnly>, and the enforcement point for App Store
 * Review Guideline 3.1.1 (In-App Purchase). The native app is a WebView
 * over taxottic.com and our subscriptions/credits run through Stripe,
 * not Apple IAP — so the app must NOT surface any purchase, upgrade,
 * pricing, or billing-management control. Wrap every such control in
 * <WebOnly>; existing subscribers still sign in and use their plan in
 * the app, and purchasing happens on the web (outside the app).
 *
 * Returns null until the platform is known (first client paint) so the
 * native app never flashes a purchase control before it's hidden.
 */
export function WebOnly({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const isNative = useIsNativeApp();
  if (isNative === null) return null;
  return isNative ? <>{fallback}</> : <>{children}</>;
}
