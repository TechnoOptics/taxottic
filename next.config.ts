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
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.plaid.com https://cdn.plaid.cloud https://js.stripe.com https://*.vercel-insights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.supabase.co https://lh3.googleusercontent.com https://avatars.githubusercontent.com",
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.anthropic.com https://api.stripe.com https://*.plaid.com https://cdn.plaid.com https://cdn.plaid.cloud https://*.vercel-insights.com",
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
  // @napi-rs/canvas ships a prebuilt native binding (.node) that Turbopack
  // can't bundle into an ESM chunk; pdfjs-dist's legacy build also breaks
  // when Turbopack tries to inline it. Mark both as runtime externals so
  // they're required normally on the server.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
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
  async redirects() {
    return [
      { source: "/firms", destination: "/book?for=firm", permanent: true },
      { source: "/firms/order", destination: "/book?for=firm", permanent: true },
    ];
  },
};

export default nextConfig;
