import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";

const SITE = "https://taxottic.com";
const TITLE = "Free Tax Calculators for the Self-Employed | Taxottic";
const DESCRIPTION =
  "Free, instant tax calculators for freelancers, 1099 contractors, and small businesses, estimate self-employment tax, income tax, and quarterly payments. No sign-up. Same IRS-aligned math as Taxottic.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/calculators" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/calculators",
    type: "website",
  },
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

// Live calculators. Add a folder under /calculators/<slug> + a card here.
const CALCULATORS = [
  {
    slug: "self-employment-tax",
    title: "Self-Employment Tax Calculator",
    blurb:
      "See your full 2026 tax on 1099 income, self-employment tax, federal and state income tax, QBI deduction, and your next quarterly payment.",
    live: true,
  },
  {
    slug: "quarterly-estimated-tax",
    title: "Quarterly Estimated Tax Calculator",
    blurb:
      "Work out what to send the IRS each quarter, all four payments and due dates, so you set the money aside and dodge the underpayment penalty.",
    live: true,
  },
  {
    slug: "1099-tax",
    title: "1099 Tax Calculator",
    blurb:
      "For independent contractors, gig workers, and freelancers, estimate your tax on 1099-NEC and 1099-K income, including what your write-offs save you.",
    live: true,
  },
  {
    slug: "mileage-deduction",
    title: "Mileage Deduction Calculator",
    blurb:
      "Turn business miles into a deduction at the 2026 IRS rate (70¢/mile) and see roughly what it saves you, for anyone who drives for work.",
    live: true,
  },
  {
    slug: "how-much-to-set-aside",
    title: "How Much to Set Aside for Taxes",
    blurb:
      "The exact percentage of every payment to move into savings so quarterly taxes are covered and April is calm, not a rule of thumb.",
    live: true,
  },
  {
    slug: "effective-tax-rate",
    title: "Effective Tax Rate Calculator",
    blurb:
      "What you actually pay across all your income, effective rate, marginal bracket, and after-tax take-home. Works for W-2 or self-employment income.",
    live: true,
  },
];

// Companion guides, the calculators answer "how much," the guides
// answer "why / how." Cross-linking both keeps people on-site and
// builds topical authority for the whole tax cluster.
const GUIDES = [
  {
    slug: "self-employment-tax-how-much-to-set-aside",
    title: "How much to set aside for self-employment tax",
  },
  {
    slug: "quarterly-estimated-taxes-explained",
    title: "Quarterly estimated taxes, explained",
  },
  {
    slug: "schedule-c-deductions",
    title: "Schedule C deductions you can write off",
  },
  {
    slug: "home-office-deduction",
    title: "The home-office deduction",
  },
  {
    slug: "business-mileage-deduction",
    title: "The business mileage deduction",
  },
  {
    slug: "qbi-deduction",
    title: "The QBI (20%) deduction",
  },
];

const BREADCRUMB_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
    {
      "@type": "ListItem",
      position: 2,
      name: "Calculators",
      item: `${SITE}/calculators`,
    },
  ],
};

const ITEMLIST_LD = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Free tax calculators",
  itemListElement: CALCULATORS.filter((c) => c.live).map((c, i) => ({
    "@type": "ListItem",
    position: i + 1,
    name: c.title,
    url: `${SITE}/calculators/${c.slug}`,
  })),
};

export default function CalculatorsHubPage() {
  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <JsonLd data={BREADCRUMB_LD} />
      <JsonLd data={ITEMLIST_LD} />

      <header
        className="relative"
        style={{
          background:
            "linear-gradient(180deg, #2a3a5e 0%, #1d2843 60%, #121a2a 100%)",
          paddingTop:
            "max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px))",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <Wordmark size="md" tone="cream" />
          <SignInIconLink />
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-6">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Free tools
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight">
          Free tax calculators for the self-employed.
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-xl leading-relaxed">
          Instant estimates for freelancers, 1099 contractors, and small
          businesses, no sign-up, nothing stored. Each one runs the same
          IRS-aligned engine Taxottic uses to keep your forecast live all year.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-4 grid gap-4">
        {CALCULATORS.filter((c) => c.live).map((c) => (
          <Link
            key={c.slug}
            href={`/calculators/${c.slug}`}
            className="card p-6 hover:border-gold-300 transition-colors"
          >
            <h2 className="display text-lg sm:text-xl text-forest-900">
              {c.title}
            </h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              {c.blurb}
            </p>
            <span className="mt-3 inline-block text-sm text-gold-800">
              Open the calculator →
            </span>
          </Link>
        ))}
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h2 className="display text-2xl text-forest-900">
          Guides to go with them
        </h2>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-xl">
          The calculators tell you how much. These plain-English guides tell you
          why, and what you can legally do to owe less.
        </p>
        <div className="mt-4 grid sm:grid-cols-2 gap-3">
          {GUIDES.map((g) => (
            <Link
              key={g.slug}
              href={`/guides/${g.slug}`}
              className="card p-4 hover:border-gold-300 transition-colors text-sm text-forest-900"
            >
              {g.title}
              <span className="block mt-1 text-xs text-gold-800">
                Read the guide →
              </span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
