import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import { PWASetup } from "@/components/PWASetup";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  // metadataBase resolves relative URLs (og:image, twitter:image, the
  // canonical alternates below) against the production origin. Without
  // it, Next.js builds with a placeholder host and Slack / iMessage
  // previews break in production. The fallback to localhost is for
  // preview deploys / dev so unit-test snapshots don't drift.
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://taxottic.com",
  ),
  title: "Taxottic - Forecast taxes, maximize deductions",
  description:
    "Tax forecasting and deduction guidance for individuals and small businesses.",
  manifest: "/manifest.webmanifest",
  applicationName: "Taxottic",
  // Default canonical at the root. Page-level metadata (e.g. /pricing,
  // /legal/dmca) can override with their own alternates.canonical. The
  // home page also renders ?audience=enterprise as a soft toggle — we
  // canonicalize back to `/` so search engines don't index the toggled
  // variant as a separate URL (May 2026 audit P2).
  alternates: { canonical: "/" },
  openGraph: {
    title: "Taxottic — Forecast taxes, maximize deductions",
    description:
      "A calmer way to handle your taxes. Bank-synced forecasts, IRS-cited deductions, gentle quarterly reminders.",
    url: "/",
    siteName: "Taxottic",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Taxottic — Forecast taxes, maximize deductions",
    description:
      "A calmer way to handle your taxes. Bank-synced forecasts, IRS-cited deductions, gentle quarterly reminders.",
  },
  // Explicit robots meta so crawlers don't have to guess. Public
  // marketing surface is intentionally indexable. Auth-gated pages set
  // their own noindex via the per-page generateMetadata where relevant.
  robots: { index: true, follow: true },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Taxottic",
  },
  formatDetection: {
    telephone: false,
  },
  // Icons intentionally omitted: Next.js picks up app/favicon.ico,
  // app/icon.png, and app/apple-icon.png via the file convention. An
  // explicit override here would shadow those generated assets and pin
  // the browser tab to a stale SVG, so leave it to the convention.
  // Likewise we don't set `openGraph.images` here — Next.js picks up
  // app/opengraph-image.tsx automatically and overriding it would
  // shadow the per-route or root opengraph-image.
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7e9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1f19" },
  ],
  width: "device-width",
  initialScale: 1,
  // No maximumScale / no userScalable=false. Capping pinch-zoom violates
  // WCAG 2.2 SC 1.4.4 (Resize Text) and breaks low-vision users who
  // rely on browser-native zoom. The May 2026 audit flagged the prior
  // `maximumScale: 5` as P1; the safe Next.js default (no cap) is what
  // ships now. If a specific screen genuinely needs a zoom cap (e.g.,
  // a canvas-based editor), set it on that screen — not globally.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col safe-pad-bottom">
        {children}
        <PWASetup />
      </body>
    </html>
  );
}
