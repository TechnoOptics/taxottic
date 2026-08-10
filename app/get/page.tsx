import { MarketingNav } from "@/components/MarketingNav";
import Link from "next/link";
import { headers } from "next/headers";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";

export const metadata = {
  title: "Get the app",
  description:
    "Install Taxottic on iPhone or Android, or open it in your browser. One link for every device.",
  alternates: { canonical: "/get" },
  openGraph: {
    title: "Get Taxottic",
    description:
      "Install Taxottic on iPhone or Android, or open it in your browser.",
    url: "/get",
    type: "website",
  },
  // A share link, not an SEO surface. Keep it out of the index so it
  // never competes with the marketing pages for the brand query.
  robots: { index: false, follow: true },
};

const APP_STORE_URL = "https://apps.apple.com/us/app/taxottic/id6767039803";
const PLAY_URL =
  "https://play.google.com/store/apps/details?id=com.taxottic.app";

type Platform = "ios" | "android" | "web";

function detectPlatform(ua: string): Platform {
  // iPadOS 13+ reports a desktop Safari UA, so the touch-Mac case is
  // folded into web on purpose: those users get the browser app, which
  // is the correct experience there anyway.
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "web";
}

/**
 * Public install page, the single link to hand a tester or a new user
 * regardless of what they are holding. Server-side UA detection picks
 * the primary action so there is no client flash and it still works
 * with JS disabled; every other option stays visible underneath because
 * UA sniffing is a hint, not a guarantee.
 *
 * Deliberately evergreen: it names no version numbers, so it never goes
 * stale while a store review is pending. Must stay in PUBLIC_PATHS
 * (lib/supabase/middleware.ts) or anonymous testers get bounced to
 * /login and the link is worthless.
 */
export default async function GetPage() {
  const ua = (await headers()).get("user-agent") ?? "";
  const platform = detectPlatform(ua);

  const store =
    platform === "ios"
      ? { href: APP_STORE_URL, label: "Download on the App Store" }
      : platform === "android"
        ? { href: PLAY_URL, label: "Get it on Google Play" }
        : null;

  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <header
        className="relative"
        style={{
          background:
            "linear-gradient(180deg, #2a3a5e 0%, #1d2843 60%, #121a2a 100%)",
          borderBottom: "1px solid rgba(213, 187, 126, 0.14)",
          paddingTop:
            "max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px))",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div className="max-w-2xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Wordmark />
          <MarketingNav />
          <SignInIconLink />
        </div>
      </header>

      <section className="max-w-2xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <div className="text-[10px] uppercase tracking-[0.32em] text-gold-700 font-medium">
          Install Taxottic
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900">
          Get the app
        </h1>
        <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-lg">
          Taxottic tracks your business drives automatically and turns them
          into a mileage deduction, alongside your income, expenses, and a
          live tax forecast. Pick your device to start.
        </p>

        {/* Primary action for the detected device. */}
        <div className="mt-8">
          {store ? (
            <a
              href={store.href}
              className="btn-primary inline-flex items-center justify-center w-full sm:w-auto px-6 py-3 text-sm"
            >
              {store.label}
            </a>
          ) : (
            <Link
              href="/login"
              className="btn-primary inline-flex items-center justify-center w-full sm:w-auto px-6 py-3 text-sm"
            >
              Open Taxottic in your browser
            </Link>
          )}
        </div>

        {/* Every option stays reachable: UA detection is a hint, and
            people forward these links between devices. */}
        <div className="mt-10 pt-8 border-t border-forest-100">
          <h2 className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
            All the ways in
          </h2>
          <ul className="mt-4 space-y-3">
            <li>
              <a
                href={APP_STORE_URL}
                className="text-sm text-forest-800 underline underline-offset-4 hover:text-forest-950"
              >
                iPhone, App Store
              </a>
            </li>
            <li>
              <a
                href={PLAY_URL}
                className="text-sm text-forest-800 underline underline-offset-4 hover:text-forest-950"
              >
                Android, Google Play
              </a>
            </li>
            <li>
              <Link
                href="/login"
                className="text-sm text-forest-800 underline underline-offset-4 hover:text-forest-950"
              >
                Any browser, no install
              </Link>
            </li>
          </ul>
          <p className="mt-6 text-xs text-ink-soft leading-relaxed max-w-lg">
            Automatic drive tracking needs the iPhone or Android app, because
            only the app can record a route in the background. The browser
            version covers everything else.
          </p>
        </div>

        <div className="mt-10 pt-8 border-t border-forest-100">
          <h2 className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
            After you install
          </h2>
          <ol className="mt-4 space-y-2 text-sm text-ink-soft leading-relaxed list-decimal pl-4">
            <li>Sign in, or create an account. The free tier needs no card.</li>
            <li>
              Open Mileage and turn on{" "}
              <span className="text-forest-800">Log my drives automatically</span>
              . Allow location <span className="text-forest-800">Always</span>{" "}
              and <span className="text-forest-800">Precise</span> when asked,
              that is what lets a drive record while your phone is in your
              pocket.
            </li>
            <li>
              Drive. A trip appears on the map shortly after you park and walk
              away.
            </li>
          </ol>
          <p className="mt-5 text-xs text-ink-soft leading-relaxed">
            Testing for us? The{" "}
            <Link
              href="/beta"
              className="text-forest-800 underline underline-offset-4"
            >
              beta checklist
            </Link>{" "}
            lists what we most want exercised, and how to send feedback.
          </p>
        </div>
      </section>
    </main>
  );
}
