import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import { PWASetup } from "@/components/PWASetup";
import { CapacitorAuth } from "@/components/CapacitorAuth";
import { CapacitorNativeInit } from "@/components/CapacitorNativeInit";
import { MileageTrackingReminder } from "@/components/MileageTrackingReminder";
import { OutdatedAppBanner } from "@/components/OutdatedAppBanner";
import { EdgeSwipeBack } from "@/components/EdgeSwipeBack";
import { IOS_APP_ID } from "@/lib/app-stores";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Body / UI typeface. Hanken Grotesk, a humanist grotesque with warmth
// and precise numerals, replaces Inter so the app reads as a bespoke
// product rather than the default modern-SaaS look. Pairs with Fraunces
// (both humanist) for a cohesive, premium voice. Variable font: the full
// 100-900 axis loads, so every weight the UI uses is covered.
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  display: "swap",
});

// --------------------------------------------------------------------
// SEO copy
//
// Title and description below are tuned for the search intent we want
// to capture in 2026:
//   - "tax forecast" / "tax estimator", high-intent commercial
//   - "1099 / freelancer / sole proprietor", audience qualifiers
//   - "Schedule C deductions", specific deduction-discovery search
//   - "quarterly estimated tax", recurring seasonal traffic
//   - "IRS-cited" / "OBBBA", current-cycle differentiator
//
// Brand voice rules: keep "calmer way" as the lead because it's the
// brand line we've consistently surfaced (audit explicitly praised
// it). Don't keyword-stuff. Don't make claims we can't substantiate.
// "1,025 IRS-cited deductions" is verifiable from
// /data/master-deductions-catalog.
//
// Length budget:
//   - Page title ≤ 60 chars (Google truncates at ~580px wide ≈ 55-60)
//   - Description ≤ 158 chars (Google truncates at ~158-160)
// --------------------------------------------------------------------
const SITE_TITLE = "Taxottic, Tax forecasting for freelancers & small business";
// Mileage is named here deliberately. It is the most differentiated
// thing the product does, and it was absent from the site description,
// the homepage description, and the SoftwareApplication featureList,
// which is the machine-readable list an answer engine reads to decide
// what Taxottic can do. "multi-state" was dropped to make room: it is a
// real capability but a weak differentiator, and it survives in
// featureList and llms.txt. 151 chars, inside the ~158 budget above.
const SITE_DESCRIPTION =
  "Bank-synced quarterly tax forecasts, automatic GPS mileage tracking, 1,025 IRS-cited deductions, and Schedule C export. Built for self-employed filers.";

// --------------------------------------------------------------------
// PERFORMANCE + WHERE THE ADMIN noindex WENT
//
// This function used to read `headers()` to detect hq./enterprise.
// taxottic.com and return a noindex payload for them. Calling a dynamic
// API in the ROOT layout opts EVERY route that inherits it out of static
// generation, so all 40 public pages (every /guides/*, /legal/*,
// /compare/*, /pricing, /help, /changelog, /calculators, /firms, /login)
// were server-rendered on demand and returned `no-store`, missing the CDN
// entirely. Measured: 3 static routes before, 40 after removing the call.
//
// The noindex was NOT deleted, it moved to two places that are stronger
// than a root-layout meta tag was:
//
//   1. lib/supabase/middleware.ts stamps `X-Robots-Tag: noindex, nofollow,
//      noarchive, nosnippet, noimageindex` on EVERY response served from
//      an admin host. Middleware sees the real request host, covers every
//      path on those hosts (including /login, /auth/*, /enterprise-welcome
//      and non-HTML responses, which a root-layout meta tag never did),
//      and cannot be bypassed by a route that overrides its own metadata.
//   2. app/admin/layout.tsx carries the cockpit title and the same robots
//      directives as static metadata, so the /admin/** tree, which is what
//      both admin hosts rewrite to, still emits a real <meta name="robots">
//      and still reads "Taxottic cockpit" in the tab.
//
// Do not reintroduce headers(), cookies() or any other dynamic API here.
// One call in this file costs the whole application its static routes.
// --------------------------------------------------------------------
export async function generateMetadata(): Promise<Metadata> {
  const base: Metadata = {
    // metadataBase anchors relative URLs (og:image, twitter:image,
    // alternates.canonical) at the production origin. Without it,
    // Next.js builds with a localhost placeholder and Slack / iMessage
    // / LinkedIn previews break in production.
    metadataBase: new URL(
      process.env.NEXT_PUBLIC_SITE_ORIGIN ?? "https://taxottic.com",
    ),
    // Title template: every per-page metadata.title becomes
    // "<Page Title> | Taxottic" automatically. Root title is the
    // standalone string that Google shows on the homepage SERP.
    title: {
      default: SITE_TITLE,
      template: "%s | Taxottic",
    },
    description: SITE_DESCRIPTION,
    manifest: "/manifest.webmanifest",
    applicationName: "Taxottic",
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "Taxottic",
    },
    formatDetection: {
      telephone: false,
    },
    // Icons intentionally omitted: Next.js picks up app/favicon.ico,
    // app/icon.png, and app/apple-icon.png via the file convention.
    // Likewise we don't set `openGraph.images` here, Next.js picks
    // up app/opengraph-image.tsx automatically.
  };

  // Consumer host, full SEO payload.
  return {
    ...base,
    // Default canonical at the root. Page-level metadata
    // (`alternates.canonical`) overrides per route. ?audience=...
    // soft toggle on the home page canonicalizes back to `/`.
    alternates: {
      canonical: "/",
      // Hint other locales (we ship en-US only today, but x-default
      // is a no-op safety net for international visitors).
      languages: { "en-US": "/", "x-default": "/" },
    },
    openGraph: {
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      url: "/",
      siteName: "Taxottic",
      type: "website",
      locale: "en_US",
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      // No @taxottic handle yet, when we own one, drop it in:
      //   site: "@taxottic",
      //   creator: "@taxottic",
    },
    robots: {
      index: true,
      follow: true,
      // Permissive snippet behavior so Google shows the full
      // description, our hero quote, and our brand artwork from
      // the dynamic OG image.
      googleBot: {
        index: true,
        follow: true,
        "max-snippet": -1,
        "max-image-preview": "large",
        "max-video-preview": -1,
      },
    },
    // Search-engine ownership verification, driven by env so the codes
    // live in Vercel (not the repo) and can rotate without a deploy.
    //   NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION  → Google Search Console
    //   NEXT_PUBLIC_BING_SITE_VERIFICATION    → Bing Webmaster Tools
    // Each key is only emitted when its env var is set, so an unset
    // var produces NO tag (Next.js skips undefined), never a broken
    // empty <meta>. To verify: add the property in Search Console /
    // Bing, copy the token into the matching Vercel env var, redeploy.
    verification: {
      google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
      other: process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION
        ? { "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION }
        : {},
    },
    category: "finance",
    // iOS Safari Smart App Banner: shows a native "Taxottic - Get" strip at
    // the top of the page on iPhone/iPad so web visitors can install the App
    // Store build in one tap. No-op on other browsers.
    itunes: { appId: IOS_APP_ID },
    keywords: [
      // Keywords are mostly ignored by Google but used by some other
      // engines (DuckDuckGo, Brave Search, internal site search). Keep
      // them tight and honest, no keyword stuffing.
      "tax forecasting",
      "self-employed tax software",
      "1099 tax estimator",
      "Schedule C deductions",
      "quarterly estimated tax",
      "freelancer tax calculator",
      "small business tax",
      "QBI deduction calculator",
      "IRS cited deductions",
      "OBBBA 2026",
    ],
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7e9" },
    { media: "(prefers-color-scheme: dark)", color: "#121a2a" },
  ],
  width: "device-width",
  initialScale: 1,
  // No maximumScale / no userScalable=false. Capping pinch-zoom violates
  // WCAG 2.2 SC 1.4.4 (Resize Text) and breaks low-vision users who
  // rely on browser-native zoom. The May 2026 audit flagged the prior
  // `maximumScale: 5` as P1; the safe Next.js default (no cap) is what
  // ships now. If a specific screen genuinely needs a zoom cap (e.g.,
  // a canvas-based editor), set it on that screen, not globally.
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
      className={`${fraunces.variable} ${hanken.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col safe-pad-bottom">
        {children}
        <PWASetup />
        <CapacitorAuth />
        <CapacitorNativeInit />
        <OutdatedAppBanner />
        <MileageTrackingReminder />
        <EdgeSwipeBack />
      </body>
    </html>
  );
}
