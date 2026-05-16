import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Taxottic mobile shell.
 *
 * Strategy: the native app is a thin wrapper around the deployed
 * taxottic.com site. `server.url` makes WebView load the live URL on
 * launch — every dashboard, forecast, billing, and settings page is
 * already mobile-responsive, so we get the full feature set without
 * a separate React Native rewrite.
 *
 * Native value-add (not "just a webview"):
 *   - `@capacitor/camera`  — receipt capture from device camera
 *   - `@capacitor/push-notifications` — quarterly tax reminders
 *   - `@capacitor/preferences` — secure local storage for the user's
 *     active company / dashboard pref
 *   - `@capacitor/haptics` — subtle nudge when a transaction applies
 *   - `@capacitor/status-bar` — match Taxottic's forest/cream theme
 *   - `@capacitor-community/background-geolocation` — opt-in
 *     automatic mileage tracking (drives → IRS deduction)
 *   - Biometric login routes through the existing WebAuthn passkeys
 *     (we already implemented that — Face ID / Touch ID work via the
 *     native authenticator without an extra plugin).
 *
 * Apple in-app-purchase rule: this app is "view + use" only. The
 * billing page links out to https://taxottic.com/billing for the
 * subscription/credit purchase flow, which routes through Stripe at
 * 2.9% instead of Apple's 30% IAP fee.
 *
 * Bundle IDs:
 *   iOS / Android: com.taxottic.app
 *
 * Display name: "Taxottic"
 */
const config: CapacitorConfig = {
  appId: "com.taxottic.app",
  appName: "Taxottic",
  webDir: "public",
  // Live mode — load the production site directly. App Review tip:
  // Apple sometimes flags 100%-remote apps under guideline 4.2.
  // Mitigations baked in: native plugins above + a real splash + an
  // offline error page (handled in app/error.tsx).
  server: {
    url: "https://taxottic.com",
    cleartext: false,
    androidScheme: "https",
  },
  ios: {
    contentInset: "automatic",
    // Brand DARK GREEN, not cream. The WebView background shows in
    // the status-bar/notch/home-indicator safe areas and on
    // overscroll. Cream (#fbf7e9) read as ugly "white bars" on a
    // device; #0a1f19 matches the header + splash so those areas
    // blend into the app instead of framing it in white.
    backgroundColor: "#0a1f19",
    // Allow apple-touch-icon to be used by Add-to-Home-Screen so the
    // PWA fallback path stays consistent.
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    backgroundColor: "#0a1f19",
    allowMixedContent: false,
    // Capture taxottic.com deep links so /auth/callback, /billing
    // success/cancel returns from Stripe checkout, and Plaid Link
    // redirects all open back inside the app rather than the
    // browser.
    captureInput: true,
  },
  plugins: {
    SplashScreen: {
      // Show our branded splash for ~1.5s while the WebView warms up.
      launchShowDuration: 1500,
      backgroundColor: "#0a1f19",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // style DARK = light/WHITE status-bar text+icons (clock,
      // battery, signal) — correct for our dark-green header.
      style: "DARK",
      backgroundColor: "#0a1f19",
      // Draw the WebView UNDER the status bar so the green header
      // extends behind it (full-screen, no white/black status-bar
      // strip). The header carries env(safe-area-inset-top) padding
      // so content still starts below the notch / Dynamic Island.
      overlaysWebView: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
  },
};

export default config;
