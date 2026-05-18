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
    // "never" = WKWebView contentInsetAdjustmentBehavior .never, so
    // the web content is pinned edge-to-edge with NO automatic
    // safe-area inset and NO elastic give. The app already owns every
    // safe area itself via CSS env(safe-area-inset-*) (header top
    // inset, body side insets, safe-pad-bottom) + the StatusBar
    // overlay, so "automatic" was DOUBLE-insetting — that was the
    // "play" / doesn't-cover-the-screen-perfectly feel. "never" makes
    // the page fill the device exactly on every size; the only bounce
    // suppression needed is the CSS overscroll-behavior:none in
    // globals.css (honoured by iOS 16+ WKWebView + Android Chromium).
    contentInset: "never",
    // Brand DARK GREEN, not cream. The WebView background shows in
    // the status-bar/notch/home-indicator safe areas and on
    // overscroll. Cream (#fbf7e9) read as ugly "white bars" on a
    // device; #121a2a matches the header + splash so those areas
    // blend into the app instead of framing it in white.
    backgroundColor: "#121a2a",
    // Allow apple-touch-icon to be used by Add-to-Home-Screen so the
    // PWA fallback path stays consistent.
    limitsNavigationsToAppBoundDomains: false,
  },
  android: {
    backgroundColor: "#121a2a",
    allowMixedContent: false,
    // Capture taxottic.com deep links so /auth/callback, /billing
    // success/cancel returns from Stripe checkout, and Plaid Link
    // redirects all open back inside the app rather than the
    // browser.
    captureInput: true,
    // Required by @capgo/background-geolocation: without the legacy
    // bridge Android halts WebView-bridge location callbacks after
    // ~5 min in the background, so mileage capture would silently die
    // mid-drive. (capacitor-community/background-geolocation#89.)
    useLegacyBridge: true,
  },
  plugins: {
    SplashScreen: {
      // Show our branded splash for ~1.5s while the WebView warms up.
      launchShowDuration: 1500,
      backgroundColor: "#121a2a",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      // style DARK = light/WHITE status-bar text+icons (clock,
      // battery, signal) — correct for our dark-green header.
      style: "DARK",
      backgroundColor: "#121a2a",
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
