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
  title: "Taxottic - Forecast taxes, maximize deductions",
  description:
    "Tax forecasting and deduction guidance for individuals and small businesses.",
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
  // app/icon.png, and app/apple-icon.png via the file convention. An
  // explicit override here would shadow those generated assets and pin
  // the browser tab to a stale SVG, so leave it to the convention.
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
