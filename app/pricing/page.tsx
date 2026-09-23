import { PageShell } from "@/components/marketing/PageShell";
import { TierTable, type TierRow } from "@/components/marketing/TierTable";
import { Faq } from "@/components/marketing/Faq";
import { JsonLd } from "@/components/seo/JsonLd";
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
// Structure: hero, the six tiers as one ruled table (a stacked ledger
// on a phone), and the FAQ. The shell supplies the header and the
// footer. Every tier is on the page at once: the old grid showed four
// cards and hid Filer and Practice behind an "Also available" line,
// which is a worse answer to "what does this cost" than six rows.

type TierKey = "free" | "filer" | "solo" | "studio" | "scale" | "practice";

// The ladder, in the order it is read: cheapest first, the two tiers
// the old grid hid (Filer, Practice) back in line with the rest.
const TIER_ORDER: TierKey[] = [
  "free",
  "filer",
  "solo",
  "studio",
  "scale",
  "practice",
];

const NAMES: Record<TierKey, string> = {
  free: "Free",
  filer: "Filer",
  solo: "Solo",
  studio: "Studio",
  scale: "Scale",
  practice: "Practice",
};

const TAGLINES: Record<TierKey, string> = {
  free: "Look around, no card.",
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

/** A cap as a reader sees it: "Unlimited", a count, or "-" for none. */
function limitLabel(value: number): string {
  if (isUnlimited(value)) return "Unlimited";
  return value === 0 ? "-" : String(value);
}

/**
 * One row per tier, built from the same PLAN_PRICING / PLAN_LIMITS the
 * billing engine reads, so a repricing cannot leave the page behind.
 * A paid CTA carries its plan name and no route: TierTable builds the
 * billing href inside its <WebOnly>, which is where the App Store 3.1.1
 * gate belongs now that the control lives there, and keeps the route
 * itself inside the file the purchase-control guard checks.
 */
const TIERS: TierRow[] = TIER_ORDER.map((tier) => {
  const pricing = priceFor(tier);
  const limits = PLAN_LIMITS[tier];
  return {
    key: tier,
    name: NAMES[tier],
    tagline: TAGLINES[tier],
    monthlyCents: pricing?.monthly ?? 0,
    yearlyCents: pricing?.yearly ?? 0,
    highlights: HIGHLIGHTS[tier],
    companies: limitLabel(limits.companies),
    bankLinks: limitLabel(limits.bankInstitutions),
    cta:
      tier === "free"
        ? { kind: "signin", href: "/login", label: "Start free" }
        : { kind: "purchase", plan: tier, label: `Choose ${NAMES[tier]}` },
    popular: tier === "solo",
  };
});

export default function PricingPage() {
  return (
    <main data-grammar="year" className="min-h-screen bg-[var(--color-cream)]">
      <PageShell current="pricing">
      {/* Structured data: Product with per-tier Offers, FAQPage with
          mirror of the visible Q&A below, and a breadcrumb so the
          SERP renders "taxottic.com › Pricing". */}
      <JsonLd data={PRODUCT_LD} />
      <JsonLd data={PRICING_FAQ_LD} />
      <JsonLd data={PRICING_BREADCRUMB_LD} />


      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 sm:pt-20 pb-6">
        {/* Left-aligned like every other header on the skin. The saving
            is still one non-breaking group so "~17%." never sits alone
            on a line, but the group is the verb plus the figure, not
            the whole clause. Measured: "Yearly saves ~17%." is 348px in
            the Year grammar's wide face (font-stretch 112%, weight 600),
            and a 344px screen gives this h1 a 312px content box, so the
            old whole-clause nowrap painted the final "%." outside the
            window and broke the 16px gutter at 375 too. "saves ~17%."
            is 230px and fits both. e2e/marketing-typography.spec.ts
            measures the span's own rect at 344, 375 and 1280, because
            html and body carry overflow-x: clip and a scrollWidth check
            can never see a box painted past the edge.

            The span carries no colour class: it renders in ink like the
            rest of the h1, so the "pricing h1 brass exception" the plan
            records no longer exists. Nothing on this page is brass. */}
        <div>
          <h1 className="display text-4xl sm:text-6xl text-forest-900 max-w-2xl leading-tight">
            Honest pricing. Yearly{" "}
            <span className="whitespace-nowrap">
              saves ~17%.
            </span>
          </h1>
          <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
            No card to try Free. No surprise overages, credits roll over
            up to 2× your monthly grant. Switch tiers anytime; we pro-rate.
          </p>
        </div>

        <div className="mt-10">
          <TierTable tiers={TIERS} />
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-16">
        <h2 className="display text-2xl text-forest-900">FAQ</h2>
        <div className="mt-6 border-t border-edge text-sm text-ink-soft leading-relaxed">
          <Faq q="Is there a free trial on paid tiers?">
            Yes, every paid tier ships with a 14-day trial. No credit
            card required to start. We send one reminder email three days
            before the trial converts. Cancel anytime from
            &ldquo;Billing &amp; plan&rdquo;.
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

      </PageShell>
    </main>
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
