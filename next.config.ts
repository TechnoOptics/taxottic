import type { NextConfig } from "next";

// Security headers applied to every response. Goals:
//   - HSTS: force HTTPS for 2 years, include subdomains, eligible for preload.
//   - X-Frame-Options: DENY framing entirely (we never embed Taxottic in
//     another site).
//   - Referrer-Policy: strict-origin-when-cross-origin so URLs (which can
//     contain ?for=firm or ?audience=enterprise) leak no path data.
//   - Permissions-Policy: deny camera/microphone/geo/payment/etc by default;
//     features we genuinely need (publickey-credentials-get/create for
//     passkeys) opt in explicitly.
//   - X-Content-Type-Options: nosniff so a misclassified MIME never gets
//     interpreted as a script.
//   - Cross-Origin-Opener-Policy: same-origin so sign-in popups don't share
//     a window with attacker contexts.
const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: [
      "accelerometer=()",
      "ambient-light-sensor=()",
      "autoplay=()",
      "battery=()",
      "camera=()",
      "display-capture=()",
      "document-domain=()",
      "encrypted-media=()",
      "fullscreen=(self)",
      "geolocation=()",
      "gyroscope=()",
      "magnetometer=()",
      "microphone=()",
      "midi=()",
      "payment=()",
      "picture-in-picture=()",
      "publickey-credentials-create=(self)",
      "publickey-credentials-get=(self)",
      "screen-wake-lock=()",
      "sync-xhr=()",
      "usb=()",
      "xr-spatial-tracking=()",
    ].join(", "),
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
  // CSP: deliberately permissive on style-src and the inline tags Next.js
  // emits during hydration, but locked to known origins for script and
  // connect targets. The list:
  //   - Plaid Link (cdn.plaid.com + cdn.plaid.cloud) for the bank-link UI.
  //   - Stripe (js.stripe.com + api.stripe.com) for checkout + portal.
  //   - Vercel insights (vitals.vercel-insights.com).
  //   - Supabase (*.supabase.co) for the auth + REST + realtime channels.
  // 'unsafe-inline' on style-src is required by the Tailwind/CSS-in-JS
  // pipeline; tightening would mean adding a nonce to every inline style,
  // which the Tailwind runtime does not currently support.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Google Maps additions (May 2026):
      //   script-src   needs maps.googleapis.com (the Maps JS loader)
      //   img-src      needs maps.gstatic.com + maps.googleapis.com
      //                (map tiles, satellite imagery, Static Maps thumbs)
      //   connect-src  needs maps.googleapis.com + maps.gstatic.com
      //                (XHR for Places autocomplete results, tile metadata)
      // Without these the browser blocks the Maps script BEFORE the
      // request reaches Google. The network panel surfaces it as a
      // generic 503, which sent us on a long debug detour through
      // referrer restrictions, billing, and SW caches before we
      // grep'd this header and saw the missing entries. Don't
      // wildcard-google: list only the Maps subdomains the loader
      // actually hits.
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.plaid.com https://cdn.plaid.cloud https://js.stripe.com https://maps.googleapis.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com https://avatars.githubusercontent.com https://maps.gstatic.com https://maps.googleapis.com https://streetviewpixels-pa.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://api.stripe.com https://*.plaid.com https://cdn.plaid.com https://cdn.plaid.cloud https://maps.googleapis.com https://maps.gstatic.com",
      "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://*.plaid.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Inline a build identifier into the CLIENT bundle, without depending on
  // Vercel's "Automatically expose System Environment Variables" toggle.
  //
  // lib/build-id.ts originally read NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA
  // directly. Vercel only inlines that when the toggle above is ON, and
  // there is no way to read the toggle's state from here, so the build id
  // could silently have been the string "dev" on every device. That would
  // make the whole web_build column a no-op, which is precisely the class
  // of failure it was added to detect. Shipping a diagnostic that cannot
  // itself be trusted is worse than not shipping one.
  //
  // VERCEL_GIT_COMMIT_SHA (no prefix) is always present in a Vercel build
  // environment, and Next inlines anything listed here into the client at
  // build time regardless of the toggle. Local builds fall through to
  // "dev", which is correct and distinguishable.
  env: {
    NEXT_PUBLIC_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ??
      "dev",
  },
  // @napi-rs/canvas ships a prebuilt native binding (.node) that Turbopack
  // can't bundle into an ESM chunk; pdfjs-dist's legacy build also breaks
  // when Turbopack tries to inline it. Mark both as runtime externals so
  // they're required normally on the server.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
  // Drop the `X-Powered-By: Next.js` header on every response. Surfacing
  // the framework name to attackers gives them a head-start on
  // CVE-matching against the running version. The May 2026 third-party
  // audit flagged this as a P2 fingerprint-reduction item; this knob is
  // the one-line fix.
  poweredByHeader: false,
  // Turn off the dev-tools overlay (the dark circular "N", bottom-left).
  //
  // It is dev-only chrome that production never serves, and the
  // visual-regression suite runs against `npm run dev` (see the webServer
  // block in playwright.config.ts), so it was being baked into the
  // committed baselines as though it were product. Measured on the
  // baselines at 48dc742: the badge is a 38x38 disc at x19-56 sitting in
  // 13 of 32 committed snapshots, and NOT in the other 19 — the same page
  // has it on Linux and not on macOS (calc-mileage-deduction desktop),
  // because the overlay mounts after hydration and races the capture.
  // That makes it both wrong and unstable: it is the entire measured
  // macOS noise floor quoted in playwright.config.ts (one of five runs
  // moved compare-hub mobile by 3,710 pixels, 0.43% of the 1% budget,
  // purely on the badge failing to paint).
  //
  // Killing it at the source rather than hiding it from the spec keeps
  // the baselines a record of what the app renders, and leaves nothing
  // for a future Next version to silently reintroduce under a changed
  // selector. Guarded by lib/visual/dev-indicators.test.ts.
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  // Marketing-friendly URLs we hand to firms in the proposal. Both
  // land on the existing public booking form with the firm audience
  // pre-selected. Permanent (308) so the cleaner URL is what crawlers
  // remember.
  //
  // `missing.host` regex: skip these redirects on the admin
  // subdomains (hq.taxottic.com, enterprise.taxottic.com). On those
  // hosts the middleware rewrites /firms to /admin/firms (the
  // firms-operator console). Without this guard, the marketing
  // redirect fires first and hijacks the URL away from the console.
  async redirects() {
    const skipAdminHosts = {
      missing: [
        {
          type: "host" as const,
          value: "(hq|enterprise)\\.taxottic\\.com",
        },
      ],
    };
    return [
      {
        source: "/firms",
        destination: "/book?for=firm",
        permanent: true,
        ...skipAdminHosts,
      },
      {
        source: "/firms/order",
        destination: "/book?for=firm",
        permanent: true,
        ...skipAdminHosts,
      },
    ];
  },
};

export default nextConfig;
