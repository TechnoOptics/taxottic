"use client";

import { useEffect } from "react";

/**
 * One-shot native runtime setup, mounted at the root layout next to
 * <PWASetup /> and <CapacitorAuth />. Pure no-op on web
 * (isNativePlatform() false). Two jobs:
 *
 *  1. StatusBar, belt-and-suspenders with capacitor.config.ts:
 *     overlay the WebView + light (white) text, so the dark-green
 *     header extends behind the status bar with readable white
 *     clock/battery/signal. Config sets this at launch; doing it
 *     again at runtime survives any plugin re-init.
 *
 *  2. Push notifications, request permission + register so the
 *     OS prompt actually appears and the device gets a token.
 *
 * NOTE (honest scope): registering for push is the CLIENT half.
 * Actual delivery still needs: iOS Push Notifications capability +
 * an APNs key, Android google-services.json + FCM, and a server to
 * send. This wires the prompt + registration; delivery infra is a
 * separate task. Until a build includes these plugins natively the
 * calls below simply no-op (isPluginAvailable guard, the lesson
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
      // iOS: overlay the WebView; the header's env(safe-area-inset-top)
      //   padding clears the notch WHEN WKWebView reports it, but that
      //   reporting has proven flaky (June 2026: hamburger/header "lost
      //   in the status bar"), so we ALSO measure the true insets
      //   natively below and publish them as CSS-var floors.
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
          // Each call gets its own guard: setOverlaysWebView is
          // platform/version dependent (e.g. "not available on
          // Android 15+"), and a throw here used to abort the WHOLE
          // block, skipping setStyle and leaving dark-on-dark
          // status-bar text. Never let one cosmetic call sink the rest.
          await StatusBar.setOverlaysWebView({ overlay: !isAndroid }).catch(
            () => {},
          );
          // Style.Dark == light/WHITE content (for dark backgrounds).
          await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
          if (!isAndroid) {
            // --- iOS: measure the REAL safe-area insets natively ---
            // The header/FAB/sheet all position off
            // env(safe-area-inset-*), but WKWebView's env() reporting
            // is not trustworthy in every state (contentInset "never"
            // + overlay combinations have shipped builds where env()
            // returned 0). Symptom: "the hamburger is lost in the
            // status bar", header chrome under the clock, FAB under
            // the home indicator. Belt-and-suspenders like Android:
            // read the exact insets from the native side
            // (capacitor-plugin-safe-area) and publish them as CSS
            // vars. Every consumer already takes
            // max(var(...), env(...)), so whichever signal is real
            // wins and a double-inset can't happen.
            const applyInsets = (top: number, bottom: number) => {
              document.documentElement.style.setProperty(
                "--app-safe-top",
                `max(env(safe-area-inset-top, 0px), ${Math.round(top)}px)`,
              );
              document.documentElement.style.setProperty(
                "--safe-bottom",
                `max(env(safe-area-inset-bottom, 0px), ${Math.round(bottom)}px)`,
              );
            };
            let measured = false;
            if (Capacitor.isPluginAvailable("SafeArea")) {
              try {
                const { SafeArea } = await import(
                  "capacitor-plugin-safe-area"
                );
                const { insets } = await SafeArea.getSafeAreaInsets();
                applyInsets(insets.top, insets.bottom);
                measured = true;
                // Rotation / Dynamic-Island changes re-report.
                void SafeArea.addListener("safeAreaChanged", (data) => {
                  applyInsets(data.insets.top, data.insets.bottom);
                }).catch(() => {});
              } catch {
                /* plugin call failed, fall through to the floor */
              }
            }
            if (!measured) {
              // Binary predates the SafeArea plugin (or the call
              // failed). Conservative floors so the chrome clears the
              // system bars on every iPhone: tall narrow screens are
              // the notch/Dynamic-Island family (~47-59pt top), classic
              // ones need ~20pt; home indicator is 34pt where present.
              // Overshoot lands as a few px of extra navy band -
              // invisible against the brand background; undershoot is
              // a button under the clock. env() still wins via max()
              // wherever it does report.
              const tallNotch =
                window.screen.height >= 780 && window.screen.width < 500;
              applyInsets(tallNotch ? 54 : 24, tallNotch ? 34 : 16);
            }
          }
          if (isAndroid) {
            // Match the header's TOP gradient stop so the OS-reserved
            // status-bar strip (overlay=false) blends into the header
            // instead of showing a hard dark band ("green bar")
            // between the clock and the header. (#121a2a is the
            // BOTTOM of the header gradient, wrong end for the strip.)
            await StatusBar.setBackgroundColor({ color: "#2a3a5e" }).catch(
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
            //, reserve a conservative strip from JS instead.
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
              /* getInfo missing in this binary, leave overlaying false */
            }
            document.documentElement.style.setProperty(
              "--app-safe-top",
              overlaying ? "28px" : "0px",
            );
          }
        } catch {
          /* plugin shape changed / not in this binary, ignore */
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
              /* APNs/FCM not provisioned yet, nothing to store */
            },
          );
          // Phase 2: a tapped action button (Business / Personal, or
          // the body itself). Hand the action + data to the server,
          // which re-auths and dispatches (reclassify a trip, etc.).
          // The interactive BUTTONS still need native category
          // registration to appear on-device (see the spec), this
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
          // CRITICAL: register() on Android calls into FirebaseMessaging
          // which throws IllegalStateException ON THE NATIVE THREAD if
          // google-services.json hasn't been installed. The native
          // throw is NOT caught by this JS try/catch, it propagates
          // up through the Capacitor plugin worker and crashes the
          // entire app process before the WebView finishes loading.
          // Diagnosed on emulator-5554 May 22, 2026.
          //
          // Gate on a build-time flag so we only call register() once
          // Firebase is actually wired up (google-services.json in
          // android/app/, GoogleService-Info.plist for iOS, env var
          // flipped). The other PushNotifications APIs (listeners,
          // checkPermissions) don't touch Firebase so they're safe to
          // keep running unconditionally, they're just no-ops without
          // a registered token.
          const pushEnabled =
            process.env.NEXT_PUBLIC_PUSH_NOTIFICATIONS_ENABLED === "1";
          if (receive === "granted" && pushEnabled) {
            await PushNotifications.register();
          }
        } catch {
          /* not in this binary / no APNs entitlement yet, ignore */
        }
      }

      // --- Mileage: re-arm background tracking if the user left it on ---
      // Watcher ids don't survive a process kill, so an explicit
      // resume on launch is required. The helper self-guards on the
      // plugin being present and also drains any points a killed-mid-
      // drive session left buffered.
      //
      // ALSO listen for App resume events. Android (esp. Samsung
      // OneUI's "Sleeping apps" + Battery Optimization defaults)
      // kills the @capgo foreground service silently while the app
      // is backgrounded. When the user opens the app again, the
      // plugin's tracking session is dead but our flag still says
      // "on", we need to call start() again. resumeMileage handles
      // both that AND the "no-op if already running" case (tracking
      // boolean in native-tracker.ts gates the second call).
      if (!cancelled) {
        try {
          const { resumeMileageTrackingIfEnabled } = await import(
            "@/lib/mileage/native-tracker"
          );
          await resumeMileageTrackingIfEnabled();
          // FIRM battery-exemption: whenever tracking is enabled, make
          // sure the OS isn't optimizing us away — auto-prompting the
          // native "allow background" dialog on every phone/tablet, so
          // no driver has to find the setup wizard to stay tracked.
          // Throttled + re-checked on resume (Samsung re-optimizes after
          // firmware updates). No-ops on iOS / older binaries.
          const ensureExempt = async () => {
            try {
              if (localStorage.getItem("taxottic.mileage.enabled") !== "1")
                return;
              const { ensureBatteryExemption } = await import(
                "@/lib/mileage/device-status"
              );
              await ensureBatteryExemption();
            } catch {
              /* best-effort */
            }
          };
          void ensureExempt();
          try {
            const { App } = await import("@capacitor/app");
            App.addListener("appStateChange", (state) => {
              if (state.isActive) {
                void resumeMileageTrackingIfEnabled().catch(() => {});
                void ensureExempt();
              }
            });
            App.addListener("resume", () => {
              void resumeMileageTrackingIfEnabled().catch(() => {});
              void ensureExempt();
            });
          } catch {
            /* @capacitor/app missing in this binary, best-effort */
          }
        } catch {
          /* plugin absent in this binary, no-op */
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
          /* bridge plugin absent in this binary, no-op */
        }
      }

      // --- Home-screen widget: push the latest forecast snapshot and
      // keep it fresh on resume. Self-guards on the TaxotticWidgetBridge
      // plugin, so web + binaries built before the widget was added are
      // a clean no-op. Independent of the watch bridge so the widget
      // works on a phone with no paired watch.
      if (!cancelled) {
        try {
          const { syncWidget, startWidgetBridge } = await import(
            "@/lib/widget/bridge"
          );
          await startWidgetBridge();
          await syncWidget();
        } catch {
          /* widget plugin absent in this binary, no-op */
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
