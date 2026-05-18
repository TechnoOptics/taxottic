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

      // --- StatusBar: per-platform so the header never overlaps it ---
      // iOS: overlay the WebView and let the header's
      //   env(safe-area-inset-top) padding clear the notch — iOS
      //   reliably reports that inset.
      // Android: DON'T overlay. Android WebView almost always reports
      //   env(safe-area-inset-top)=0 even when drawing under the
      //   status bar, so the header rendered ON TOP of the clock /
      //   battery ("header overlapping the notification bar"). With
      //   overlay=false the OS reserves a solid status-bar strip; we
      //   paint it the brand dark green so it's seamless with the
      //   header and the header starts cleanly below it.
      if (Capacitor.isPluginAvailable("StatusBar")) {
        try {
          const isAndroid = Capacitor.getPlatform() === "android";
          const { StatusBar, Style } = await import("@capacitor/status-bar");
          await StatusBar.setOverlaysWebView({ overlay: !isAndroid });
          // Style.Dark == light/WHITE content (for dark backgrounds).
          await StatusBar.setStyle({ style: Style.Dark });
          if (isAndroid) {
            await StatusBar.setBackgroundColor({ color: "#121a2a" }).catch(
              () => {},
            );
            // Android safe-top is platform-dependent and env() can't be
            // trusted (the Android WebView reports
            // env(safe-area-inset-top)=0 even when drawing UNDER the
            // status bar). Two real-world states:
            //
            //  - WebView is BELOW the status bar (the native
            //    `windowOptOutEdgeToEdgeEnforcement` opt-out in
            //    styles.xml is present, i.e. a fresh build): the OS
            //    reserves the strip, so the header needs 0 extra inset.
            //  - WebView is OVERLAYING the status bar (older binaries
            //    that predate the opt-out, or forced edge-to-edge on
            //    API 35): now that the header is truly position:fixed
            //    it pins to the physical top and sits behind the
            //    clock/battery. env() is 0 here so CSS can't rescue it
            //    — reserve a conservative strip from JS instead.
            //
            // getInfo().overlays reflects the actual window state, so
            // this self-corrects: fresh builds report not-overlaying →
            // 0px (no double gap); old builds report overlaying → a
            // status-bar strip clears the clock. ~28px covers the
            // common 24dp bar plus slack for camera cutouts; the
            // header background is brand dark-green so a small
            // overshoot is an invisible green band, never a clash.
            let overlaying = false;
            try {
              const info = await StatusBar.getInfo();
              overlaying = Boolean(
                (info as { overlays?: boolean })?.overlays,
              );
            } catch {
              /* getInfo missing in this binary — leave overlaying false */
            }
            document.documentElement.style.setProperty(
              "--app-safe-top",
              overlaying ? "28px" : "0px",
            );
          }
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
          // Phase 2: a tapped action button (Business / Personal, or
          // the body itself). Hand the action + data to the server,
          // which re-auths and dispatches (reclassify a trip, etc.).
          // The interactive BUTTONS still need native category
          // registration to appear on-device (see the spec) — this
          // listener also fires for the default "tap" so the routing
          // is correct the moment categories land.
          await PushNotifications.addListener(
            "pushNotificationActionPerformed",
            (e: {
              actionId: string;
              notification: { data?: Record<string, string> };
            }) => {
              void fetch("/api/push/action", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                credentials: "include",
                body: JSON.stringify({
                  data: e.notification?.data ?? {},
                  actionId: e.actionId,
                }),
              }).catch(() => {});
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

      // --- Watch: push the latest glance + listen for one-tap
      // actions. Self-guards on the TaxotticWatchBridge plugin being
      // present, so binaries built before the watch target is added
      // (and web) are a clean no-op.
      if (!cancelled) {
        try {
          const { syncWatch, startWatchBridge } = await import(
            "@/lib/watch/bridge"
          );
          await startWatchBridge();
          await syncWatch();
        } catch {
          /* bridge plugin absent in this binary — no-op */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
