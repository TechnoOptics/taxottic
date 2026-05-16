"use client";

import { useEffect } from "react";

/**
 * One-shot native runtime setup, mounted at the root layout next to
 * <PWASetup /> and <CapacitorAuth />. Pure no-op on web
 * (isNativePlatform() false). Two jobs:
 *
 *  1. StatusBar — belt-and-suspenders with capacitor.config.ts:
 *     overlay the WebView + light (white) text, so the dark-green
 *     header extends behind the status bar with readable white
 *     clock/battery/signal. Config sets this at launch; doing it
 *     again at runtime survives any plugin re-init.
 *
 *  2. Push notifications — request permission + register so the
 *     OS prompt actually appears and the device gets a token.
 *
 * NOTE (honest scope): registering for push is the CLIENT half.
 * Actual delivery still needs: iOS Push Notifications capability +
 * an APNs key, Android google-services.json + FCM, and a server to
 * send. This wires the prompt + registration; delivery infra is a
 * separate task. Until a build includes these plugins natively the
 * calls below simply no-op (isPluginAvailable guard — the lesson
 * from the #69 "Browser plugin not implemented" regression: never
 * call a native plugin that may be absent from the running binary).
 */
export function CapacitorNativeInit() {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (typeof window === "undefined") return;
      let Capacitor:
        | {
            isNativePlatform: () => boolean;
            isPluginAvailable: (n: string) => boolean;
            getPlatform: () => string;
          }
        | undefined;
      try {
        ({ Capacitor } = await import("@capacitor/core"));
      } catch {
        return;
      }
      if (!Capacitor?.isNativePlatform()) return;

      // --- StatusBar: overlay + white text ---
      if (Capacitor.isPluginAvailable("StatusBar")) {
        try {
          const { StatusBar, Style } = await import("@capacitor/status-bar");
          await StatusBar.setOverlaysWebView({ overlay: true });
          // Style.Dark == light/WHITE content (for dark backgrounds).
          await StatusBar.setStyle({ style: Style.Dark });
        } catch {
          /* plugin shape changed / not in this binary — ignore */
        }
      }

      // --- Push notifications: request + register ---
      if (
        !cancelled &&
        Capacitor.isPluginAvailable("PushNotifications")
      ) {
        try {
          const { PushNotifications } = await import(
            "@capacitor/push-notifications"
          );
          // Capture the APNs/FCM token and persist it server-side so
          // the Phase-1 send pipeline has somewhere to deliver. Listen
          // BEFORE register() so the registration event isn't missed.
          // Best-effort: a failed POST just means no push until the
          // next cold start re-registers.
          const platform = Capacitor.getPlatform();
          await PushNotifications.addListener(
            "registration",
            (t: { value: string }) => {
              void fetch("/api/push/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({ token: t.value, platform }),
              }).catch(() => {});
            },
          );
          await PushNotifications.addListener(
            "registrationError",
            () => {
              /* APNs/FCM not provisioned yet — nothing to store */
            },
          );
          const perm = await PushNotifications.checkPermissions();
          let receive = perm.receive;
          if (receive === "prompt" || receive === "prompt-with-rationale") {
            receive = (await PushNotifications.requestPermissions()).receive;
          }
          if (receive === "granted") {
            await PushNotifications.register();
          }
        } catch {
          /* not in this binary / no APNs entitlement yet — ignore */
        }
      }

      // --- Mileage: re-arm background tracking if the user left it on ---
      // Watcher ids don't survive a process kill, so an explicit
      // resume on launch is required. The helper self-guards on the
      // plugin being present and also drains any points a killed-mid-
      // drive session left buffered.
      if (!cancelled) {
        try {
          const { resumeMileageTrackingIfEnabled } = await import(
            "@/lib/mileage/native-tracker"
          );
          await resumeMileageTrackingIfEnabled();
        } catch {
          /* plugin absent in this binary — no-op */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
