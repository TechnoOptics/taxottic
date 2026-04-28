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
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbf7e9" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1f19" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
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
