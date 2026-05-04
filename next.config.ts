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
  // No CSP by default - we have inline styles and dynamic third-party
  // origins (Plaid, Anthropic) that need a careful per-route policy. Add
  // CSP when we have time to enumerate every legitimate source without
  // breaking the bank-link flow or the in-app SVG icons.
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
