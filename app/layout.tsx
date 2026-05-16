import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Fraunces, Inter } from "next/font/google";
import { PWASetup } from "@/components/PWASetup";
import { CapacitorAuth } from "@/components/CapacitorAuth";
import { CapacitorNativeInit } from "@/components/CapacitorNativeInit";
import { EdgeSwipeBack } from "@/components/EdgeSwipeBack";
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

// --------------------------------------------------------------------
// SEO copy
//
// Title and description below are tuned for the search intent we want
// to capture in 2026:
//   - "tax forecast" / "tax estimator" — high-intent commercial
//   - "1099 / freelancer / sole proprietor" — audience qualifiers
//   - "Schedule C deductions" — specific deduction-discovery search
//   - "quarterly estimated tax" — recurring seasonal traffic
//   - "IRS-cited" / "OBBBA" — current-cycle differentiator
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
const SITE_TITLE = "Taxottic — Tax forecasting for freelancers & small business";
const SITE_DESCRIPTION =
  "Bank-synced quarterly tax forecasts, 1,025 IRS-cited deductions, Schedule C export, multi-state. Calm, accurate, and built for self-employed filers.";

const ADMIN_HOSTS = new Set(["hq.taxottic.com", "enterprise.taxottic.com"]);

export async function generateMetadata(): Promise<Metadata> {
  // Host-aware metadata. Admin subdomains get a hard noindex / nofollow
  // so the operator console never appears in any crawler's index.
  // Consumer host gets the full keyword-aware SEO payload.
  const host = (await headers()).get("host")?.toLowerCase() ?? "";
  const isAdminHost = ADMIN_HOSTS.has(host);

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
    // Likewise we don't set `openGraph.images` here — Next.js picks
    // up app/opengraph-image.tsx automatically.
  };

  if (isAdminHost) {
    // Admin subdomains: zero search visibility. We pass title +
    // description through so the browser tab and OG previews
    // (e.g., when an operator shares a link internally) still render
    // sensibly, but every robots directive says "don't index, don't
    // follow, don't cache, don't archive."
    return {
      ...base,
      title: {
        default: "Taxottic cockpit",
        template: "%s | Taxottic cockpit",
      },
      description: "Operator console — not for public access.",
      robots: {
        index: false,
        follow: false,
        nocache: true,
        googleBot: {
          index: false,
          follow: false,
          noimageindex: true,
          "max-snippet": 0,
          "max-image-preview": "none",
          "max-video-preview": 0,
        },
      },
      openGraph: {
        title: "Taxottic cockpit",
        description: "Operator console — not for public access.",
        url: "/",
        siteName: "Taxottic",
        type: "website",
      },
    };
  }

  // Consumer host — full SEO payload.
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
      // No @taxottic handle yet — when we own one, drop it in:
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
    // Verification placeholder — once you wire up Search Console /
    // Bing Webmaster Tools, add the meta tags here. Leaving keys
    // unset means Next.js skips them (no broken empty tags).
    verification: {
      // google: "<paste verification meta-tag content here>",
      // other: { "msvalidate.01": "<bing verification>" },
    },
    category: "finance",
    keywords: [
      // Keywords are mostly ignored by Google but used by some other
      // engines (DuckDuckGo, Brave Search, internal site search). Keep
      // them tight and honest — no keyword stuffing.
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
        <CapacitorAuth />
        <CapacitorNativeInit />
        <EdgeSwipeBack />
      </body>
    </html>
  );
}
