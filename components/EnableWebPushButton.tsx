"use client";

import { useEffect, useState } from "react";
import { enableWebPush } from "@/lib/push/web";

// Baked at build time. Only offer the control when this build actually
// has web push wired (VAPID key + the enable flag), so we never show a
// button that can't work.
const CONFIGURED =
  process.env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "1" &&
  !!process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

/**
 * Web-only "Enable notifications" control. Browsers require a user
 * gesture to call Notification.requestPermission(), so the web push
 * subscription (lib/push/web.ts) can't self-start, this button is that
 * gesture. Once granted, enableWebPush() also creates + registers the
 * PushSubscription.
 *
 * Hidden inside the native app (the Capacitor shell registers push
 * itself via CapacitorNativeInit) and in browsers without the Push API.
 * Otherwise it reflects the current permission: not-yet-asked shows a
 * button; granted shows a confirmation; denied explains how to unblock.
 */
export function EnableWebPushButton() {
  const [mounted, setMounted] = useState(false);
  const [supported, setSupported] = useState(false);
  const [isNative, setIsNative] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot mount + client-only capability/permission read
    setMounted(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((window as any).Capacitor?.isNativePlatform?.() === true) {
        setIsNative(true);
        return;
      }
    } catch {
      /* not in a Capacitor context */
    }
    const ok =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;
    setSupported(ok);
    if (ok) setPermission(Notification.permission);
  }, []);

  async function turnOn() {
    setPending(true);
    try {
      setPermission(await enableWebPush());
    } finally {
      setPending(false);
    }
  }

  // SSR and first client render must match: render nothing until mounted.
  if (!mounted) return null;
  // Native shell manages its own push; nothing to do here.
  if (isNative) return null;
  // This build has no web push configured (should not happen in prod).
  if (!CONFIGURED) return null;

  if (!supported) {
    return (
      <p className="text-sm text-ink-soft">
        This browser doesn&apos;t support web notifications. Try Chrome or
        Edge, or install Taxottic to your home screen.
      </p>
    );
  }

  if (permission === "granted") {
    return (
      <p className="text-sm text-emerald-800">
        Notifications are on for this browser.
      </p>
    );
  }

  if (permission === "denied") {
    return (
      <p className="text-sm text-ink-soft">
        Notifications are blocked. Turn them back on in your browser&apos;s
        site settings for taxottic.com, then reload this page.
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={turnOn}
      disabled={pending}
      className="btn-primary text-sm h-10 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending ? "..." : "Enable notifications"}
    </button>
  );
}
