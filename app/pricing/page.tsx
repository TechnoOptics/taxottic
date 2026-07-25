import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";
import { WebOnly } from "@/components/WebOnly";
import { PLAN_LIMITS, PLAN_PRICING, isUnlimited } from "@/lib/plans/limits";

export const metadata = {
  // The title template in app/layout.tsx will append " | Taxottic".
  title: "Pricing, Free, Filer, Solo, Studio, Scale, Practice",
  description:
    "Honest pricing for tax forecasting. Free tier with no card. Paid tiers from $4.99/mo. Yearly saves ~17%. 14-day trial on every paid plan.",
  alternates: { canonical: "/pricing" },
  openGraph: {
    title: "Taxottic Pricing, Free to start, $4.99/mo to scale",
    description:
      "Honest tax-forecasting pricing for freelancers, growing businesses, and tax-prep firms. Yearly saves ~17%.",
    url: "/pricing",
    type: "website",
  },
  // Pricing pages are conversion-critical; explicit index, follow,
  // big snippets so Google can render the full tier breakdown
  // in the SERP description.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
    },
  },
};

// Product JSON-LD with one Offer per paid tier. Eligible for Google's
// merchant rich-result treatment (price + currency + free-trial dates
// shown in SERP). Free tier is intentionally not an Offer because
// schema.org's commercial-offer semantics imply a transaction; the
// freeTrialAvailability fields cover that better.
const PRICING_PAGE_URL = "https://taxottic.com/pricing";
const PRODUCT_LD = {
  "@context": "https://schema.org",
  "@type": "Product",
  "@id": `${PRICING_PAGE_URL}#product`,
  name: "Taxottic",
  description:
    "Tax forecasting software for freelancers, sole proprietors, and small businesses. Bank-synced quarterly estimates, 1,025 IRS-cited deductions, Schedule C export, multi-state.",
  brand: { "@type": "Brand", name: "Taxottic" },
  category: "Finance > Tax software",
  image: "https://taxottic.com/opengraph-image.png",
  offers: (
    [
      ["filer_monthly", "Filer monthly"],
      ["filer_yearly", "Filer yearly"],
      ["solo_monthly", "Solo monthly"],
      ["solo_yearly", "Solo yearly"],
      ["studio_monthly", "Studio monthly"],
      ["studio_yearly", "Studio yearly"],
      ["scale_monthly", "Scale monthly"],
      ["scale_yearly", "Scale yearly"],
      ["practice_monthly", "Practice monthly"],
      ["practice_yearly", "Practice yearly"],
    ] as const
  ).map(([key, label]) => {
    const p = PLAN_PRICING[key];
    const price = (p.amountCents / 100).toFixed(2);
    return {
      "@type": "Offer",
      name: label,
      price,
      priceCurrency: "USD",
      url: `${PRICING_PAGE_URL}#${key.replace("_", "-")}`,
      // ItemAvailability, "InStock" maps to "available to subscribe"
      // for software subscriptions per Google's guidelines.
      availability: "https://schema.org/InStock",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price,
        priceCurrency: "USD",
        billingDuration: p.interval === "month" ? "P1M" : "P1Y",
        unitText: p.interval,
      },
    };
  }),
};

// FAQPage JSON-LD with our own pricing FAQ. Two birds: helps Google
// render an FAQ accordion under the SERP card, and keeps the answers
// honest. Mirror the visible Q&A copy below exactly, Google rejects
// FAQ schema where the structured data and visible page diverge.
const PRICING_FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Is there a free trial on paid tiers?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, every paid tier ships with a 14-day trial. No credit card required to start. Cancel anytime from Billing & plan, and the app shows your trial's days remaining while it's running.",
      },
    },
    {
      "@type": "Question",
      name: "How does the credit grant work?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Each tier includes a monthly grant of AI credits (used by Bella, receipt OCR, document OCR, and bulk-categorize). Unused monthly credits roll over up to 2x the grant. Past that they evaporate on the next refresh. Top-up packs you buy never expire.",
      },
    },
    {
      "@type": "Question",
      name: "Can I buy more credits without upgrading?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Top-up packs are available on every paid tier and are capped at 3x your monthly grant per billing period, enough for a heavy month, not enough to operate at a higher tier on cheap credits.",
      },
    },
    {
      "@type": "Question",
      name: "What about state taxes?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Federal forecast is included on every paid tier. Multi-state (forecast with real bracket math across multiple state returns) unlocks at Studio and above.",
      },
    },
    {
      "@type": "Question",
      name: "Do you offer non-profit or student discounts?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, 50% off Solo or Studio for verified 501(c)(3) non-profits and full-time students with a valid .edu address. Email contact@taxottic.com with proof and we'll set you up.",
      },
    },
    {
      "@type": "Question",
      name: "Is Taxottic a substitute for a CPA?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. Taxottic provides tax forecasting and educational guidance, it is not a substitute for advice from a licensed CPA or tax attorney. When you need one, the Find a tax preparer feature connects you to vetted preparers; we never offer legal advice ourselves.",
      },
    },
  ],
};

// BreadcrumbList so Google shows "taxottic.com › Pricing" instead of
// the raw URL in the SERP. Two items is the minimum useful breadcrumb.
const PRICING_BREADCRUMB_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    {
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://taxottic.com/",
    },
    {
      "@type": "ListItem",
      position: 2,
      name: "Pricing",
      item: PRICING_PAGE_URL,
    },
  ],
};

// Public pricing page. The May 2026 audit flagged P1-6: `/pricing` used
// to redirect to /login, which is friction for any B2B / SMB prospect.
// Numbers here mirror PLAN_PRICING + PLAN_LIMITS in lib/plans/limits.ts
// so a price change in one place flows to both surfaces. If you change
// pricing, update limits.ts and the strings here in the same commit so
// they never drift.
//
// Structure: hero, audience-aware tier grid (4 cards visible by
// default; the smaller Filer + bigger Scale/Practice tiers expand on
// click), the comparison table, the FAQ, and the disclaimer / footer.

type TierKey = "free" | "filer" | "solo" | "studio" | "scale" | "practice";

function fmtCents(cents: number): string {
  if (cents % 100 === 0) return `$${cents / 100}`;
  return `$${(cents / 100).toFixed(2)}`;
}

// Capture the four primary tiers shown side-by-side. Filer is the
// secondary entry-paid tier (W-2 only), we link to it but don't show
// it on the main card row, since the most common starting point is
// Solo or Studio.
const PRIMARY: TierKey[] = ["free", "solo", "studio", "scale"];

const TAGLINES: Record<TierKey, string> = {
  free: "Try the calm, no card.",
  filer: "W-2 employee, single forecast.",
  solo: "Freelancer or sole proprietor.",
  studio: "Growing business, small team.",
  scale: "Mid-market with bookkeeping needs.",
  practice: "CPA / tax-prep firms.",
};

const HIGHLIGHTS: Record<TierKey, string[]> = {
  free: [
    "Personal dashboard",
    "Read /example sample data",
    "Reminders & calendar",
    "Magic-link or passkey sign-in",
  ],
  filer: [
    "Personal W-2 forecast",
    "Ask Bella (Haiku)",
    "30 AI credits / month",
    "Connect a tax preparer",
  ],
  solo: [
    "Schedule C / 1099 forecast",
    "Plaid bank sync (1 institution)",
    "CSV imports (5 / month)",
    "Ask Bella (Sonnet)",
    "400 AI credits / month",
  ],
  studio: [
    "Up to 3 companies",
    "Invite team (5 / company)",
    "Plaid (3 institutions)",
    "Team chat",
    "Multi-state forecast",
    "1,500 AI credits / month",
  ],
  scale: [
    "Up to 10 companies",
    "Unlimited bank institutions",
    "Unlimited CSV imports",
    "Priority support",
    "Audit support",
    "5,000 AI credits / month",
  ],
  practice: [
    "Unlimited companies",
    "Preparer cockpit",
    "Per-client or per-seat billing",
    "Priority + audit support",
    "15,000 AI credits / month",
  ],
};

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      {/* Structured data: Product with per-tier Offers, FAQPage with
          mirror of the visible Q&A below, and a breadcrumb so the
          SERP renders "taxottic.com › Pricing". */}
      <JsonLd data={PRODUCT_LD} />
      <JsonLd data={PRICING_FAQ_LD} />
      <JsonLd data={PRICING_BREADCRUMB_LD} />

      <header
        className="relative"
        style={{
          background:
            "linear-gradient(180deg, #2a3a5e 0%, #1d2843 60%, #121a2a 100%)",
          borderBottom: "1px solid rgba(213, 187, 126, 0.14)",
          // Native iOS overlays the WebView under the status bar, pad by
          // the real safe-area inset so the wordmark clears the notch /
          // Dynamic Island (matches app/page.tsx + AppHeader). 0 on web.
          paddingTop:
            "max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px))",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="Taxottic home">
            <Wordmark size="md" tone="cream" />
          </Link>
          <SignInIconLink />
        </div>
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 bottom-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(213,187,126,0.55) 35%, rgba(242,216,150,0.95) 50%, rgba(213,187,126,0.55) 65%, transparent 100%)",
          }}
        />
      </header>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-6">
        <div className="text-center">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Pricing
          </div>
          <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 max-w-2xl mx-auto leading-tight">
            Honest pricing. <span className="gold-shine">Yearly saves ~17%.</span>
          </h1>
          <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl mx-auto leading-relaxed">
            No card to try Free. No surprise overages, credits roll over
            up to 2× your monthly grant. Switch tiers anytime; we pro-rate.
          </p>
        </div>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PRIMARY.map((tier) => (
            <TierCard key={tier} tier={tier} />
          ))}
        </div>

        <div className="mt-8 text-center text-xs text-ink-muted">
          Also available:{" "}
          <a href="#filer" className="underline hover:text-forest-900">
            Filer
          </a>{" "}
          (W-2 only) and{" "}
          <a href="#practice" className="underline hover:text-forest-900">
            Practice
          </a>{" "}
          (firms with 10+ clients).
        </div>
      </section>

      {/* Secondary tiers (Filer + Practice) shown below the primary row */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <TierCard tier="filer" anchor="filer" />
          <TierCard tier="practice" anchor="practice" />
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h2 className="display text-2xl text-forest-900">FAQ</h2>
        <div className="mt-6 grid gap-5 text-sm text-ink-soft leading-relaxed">
          <Faq q="Is there a free trial on paid tiers?">
            Yes, every paid tier ships with a 14-day trial. No credit
            card required to start. We send one reminder email three days
            before the trial converts. Cancel anytime from{" "}
            <em>Billing &amp; plan</em>.
          </Faq>
          <Faq q="How does the credit grant work?">
            Each tier includes a monthly grant of AI credits (used by
            Bella, receipt OCR, document OCR, and bulk-categorize).
            Unused monthly credits roll over up to 2× the grant. Past
            that they evaporate on the next refresh, so you can&apos;t
            stockpile a year of unused credits then use them as a one-
            month burst. Top-up packs you buy never expire.
          </Faq>
          <Faq q="Can I buy more credits without upgrading?">
            Yes. Top-up packs are available on every paid tier and are
            capped at 3× your monthly grant per billing period, enough
            for a heavy month, not enough to operate at a higher tier on
            cheap credits.
          </Faq>
          <Faq q="What about state taxes?">
            Federal forecast is included on every paid tier. Multi-state
            (forecast with real bracket math across multiple state
            returns) unlocks at Studio and above.
          </Faq>
          <Faq q="Do you offer non-profit / student discounts?">
            Yes, 50% off Solo or Studio for verified 501(c)(3) non-
            profits and full-time students with a valid .edu address.
            Email{" "}
            <a
              href="mailto:contact@taxottic.com"
              className="underline hover:text-forest-900"
            >
              contact@taxottic.com
            </a>{" "}
            with proof and we&apos;ll set you up.
          </Faq>
          <Faq q="Is Taxottic a substitute for a CPA?">
            No. Taxottic provides tax forecasting and educational
            guidance, it is not a substitute for advice from a licensed
            CPA or tax attorney. When you need one, the &ldquo;Find a tax
            preparer&rdquo; feature connects you to vetted preparers; we
            never offer legal advice ourselves.
          </Faq>
        </div>
      </section>

      <footer className="border-t border-forest-100 bg-cream">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 grid gap-4 sm:grid-cols-2 text-xs text-ink-muted">
          <div>
            <Wordmark size="sm" tone="forest" />
            <p className="mt-2 leading-relaxed max-w-md">
              Taxottic provides tax forecasting and educational guidance.
              It is not a substitute for advice from a licensed CPA or
              tax attorney.
            </p>
            <p className="mt-3 leading-relaxed">
              Made by{" "}
              <a
                href="https://technooptics.com"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-forest-900"
              >
                Techno Optics LLC
              </a>
              .
            </p>
          </div>
          <div className="sm:text-right grid gap-1">
            <Link href="/legal" className="hover:text-forest-900">
              Legal hub
            </Link>
            <Link href="/legal/privacy" className="hover:text-forest-900">
              Privacy
            </Link>
            <Link href="/legal/terms" className="hover:text-forest-900">
              Terms
            </Link>
            <Link href="/legal/security" className="hover:text-forest-900">
              Security
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function TierCard({ tier, anchor }: { tier: TierKey; anchor?: string }) {
  const pricing = priceFor(tier);
  const limits = PLAN_LIMITS[tier];
  const isFeatured = tier === "solo";
  return (
    <article
      id={anchor}
      className={
        "card p-6 grid gap-3 " +
        (isFeatured
          ? "ring-1 ring-gold-300/70 shadow-lg shadow-forest-900/5"
          : "")
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="display text-xl text-forest-900 capitalize">{tier}</h3>
        {isFeatured ? (
          <span className="text-[10px] uppercase tracking-[0.18em] text-gold-700 font-medium">
            Most popular
          </span>
        ) : null}
      </div>
      <p className="text-xs text-ink-muted -mt-1">{TAGLINES[tier]}</p>

      <div className="mt-1">
        {pricing ? (
          <>
            <div className="display text-3xl text-forest-900">
              {fmtCents(pricing.monthly)}
              <span className="text-sm text-ink-muted font-normal">/mo</span>
            </div>
            <div className="text-[11px] text-ink-muted mt-1">
              or {fmtCents(pricing.yearly)}/yr · billed annually
            </div>
          </>
        ) : (
          <div className="display text-3xl text-forest-900">$0</div>
        )}
      </div>

      <ul className="mt-3 grid gap-2 text-sm text-ink-soft">
        {HIGHLIGHTS[tier].map((line) => (
          <li key={line} className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-1 inline-block size-1.5 rounded-full bg-gold-500 shrink-0"
            />
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="mt-2 text-[11px] text-ink-muted grid gap-1">
        <span>
          Companies:{" "}
          <span className="text-forest-800 font-medium">
            {isUnlimited(limits.companies)
              ? "Unlimited"
              : limits.companies === 0
                ? "-"
                : limits.companies}
          </span>
        </span>
        <span>
          Bank links:{" "}
          <span className="text-forest-800 font-medium">
            {isUnlimited(limits.bankInstitutions)
              ? "Unlimited"
              : limits.bankInstitutions === 0
                ? "-"
                : limits.bankInstitutions}
          </span>
        </span>
      </div>

      {tier === "free" ? (
        // "Start free" is sign-in only (no purchase), fine everywhere.
        <Link
          href="/login"
          className={
            "mt-4 " +
            (isFeatured ? "btn-primary" : "btn-ghost") +
            " w-full text-center"
          }
        >
          Start free
        </Link>
      ) : (
        // Paid CTAs funnel to billing, web only (App Store 3.1.1). The
        // gate is client-side, so crawlers still index the CTA (SEO); the
        // native app shows a non-tappable note instead.
        <WebOnly
          fallback={
            <span className="mt-4 block w-full text-center text-xs text-ink-muted">
              Subscribe at taxottic.com
            </span>
          }
        >
          <Link
            href={`/login?next=/billing&plan=${tier}`}
            className={
              "mt-4 " +
              (isFeatured ? "btn-primary" : "btn-ghost") +
              " w-full text-center"
            }
          >
            Choose {tier}
          </Link>
        </WebOnly>
      )}
    </article>
  );
}

function priceFor(
  tier: TierKey,
): { monthly: number; yearly: number } | null {
  if (tier === "free") return null;
  const monthly = PLAN_PRICING[`${tier}_monthly`].amountCents;
  const yearly = PLAN_PRICING[`${tier}_yearly`].amountCents;
  return { monthly, yearly };
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="display text-base text-forest-900">{q}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}
