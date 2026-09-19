import { PageShell } from "@/components/marketing/PageShell";
import { LedgerList } from "@/components/marketing/LedgerList";
import { JsonLd } from "@/components/seo/JsonLd";
import { getTaxYearConstants } from "@/lib/tax/constants";
import { ratePeriodsForYear } from "@/lib/calculators/mileage-reimbursement";

const SITE = "https://taxottic.com";
const MILEAGE_TAX_YEAR = 2026;
const MILEAGE_RATE_CENTS = getTaxYearConstants(MILEAGE_TAX_YEAR)
  .MILEAGE_RATE_PER_MILE_CENTS;
// Both rates, derived. 2026 is a split-rate year, so naming only the
// first would repeat the mistake the mileage calculator already made.
const MILEAGE_RATE_LABEL = ratePeriodsForYear(MILEAGE_TAX_YEAR)
  .map((p) => `${p.centsPerMile}\u00a2`)
  .join(" then ") + " per mile";
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

// Live calculators. Add a folder under /calculators/<slug> + a row here.
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
      // Rate read from the tax engine, not typed. The hub carried a stale
      // 70¢ while the engine (and the calculator itself) was on 72.5¢.
      `Turn business miles into a deduction at the ${MILEAGE_TAX_YEAR} IRS rate (${MILEAGE_RATE_CENTS}¢/mile) and see roughly what it saves you, for anyone who drives for work.`,
    live: true,
  },
  {
    slug: "mileage-log",
    title: "IRS Mileage Log",
    blurb:
      "Enter your business trips and get a log with the date, purpose and miles Publication 463 expects, priced per trip date. Download as CSV, nothing uploaded.",
    live: true,
  },
  {
    slug: "mileage-reimbursement",
    title: "Employee Mileage Reimbursement Calculator",
    blurb:
      `What reimbursing your team's business driving costs for the year at the IRS standard rate (${MILEAGE_RATE_LABEL}), and the net cost after the deduction.`,
    live: true,
  },
  {
    slug: "how-much-to-set-aside",
    title: "How Much to Set Aside for Taxes",
    blurb:
      "The exact percentage of every payment to move into savings so quarterly taxes are covered before April, not a rule of thumb.",
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
    <main data-grammar="year" className="min-h-screen bg-[var(--color-cream)]">
      <PageShell current="calculators">
      <JsonLd data={BREADCRUMB_LD} />
      <JsonLd data={ITEMLIST_LD} />


      <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-6">
        {/* Reordered, not resized. "Free tax calculators for the
            self-employed." ran to four lines at 344px (measured: the
            h1's content box is 312px there and "Free tax calculators"
            alone is 386px), one over the bound the rest of the shell
            holds to. The same four words in the order below break as
            "Free" / "self-employed" / "tax calculators." and land on
            three, so the keyword phrase survives intact and the type
            scale is untouched. The compound stays one non-breaking
            group so it never splits at its hyphen. */}
        <h1 className="display text-4xl sm:text-6xl text-forest-900 leading-tight">
          Free <span className="whitespace-nowrap">self-employed</span> tax
          calculators.
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-xl leading-relaxed">
          Instant estimates for freelancers, 1099 contractors, and small
          businesses, no sign-up, nothing stored. Each one runs the same
          IRS-aligned engine Taxottic uses to keep your forecast live all year.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-4">
        <LedgerList
          ariaLabel="Calculators"
          items={CALCULATORS.filter((c) => c.live).map((c) => ({
            href: `/calculators/${c.slug}`,
            title: c.title,
            blurb: c.blurb,
          }))}
        />
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h2 className="display text-2xl text-forest-900">
          Guides to go with them
        </h2>
        <p className="mt-2 text-sm text-ink-soft leading-relaxed max-w-xl">
          The calculators tell you how much. These plain-English guides tell you
          why, and what you can legally do to owe less.
        </p>
        <div className="mt-4">
          <LedgerList
            ariaLabel="Guides"
            items={GUIDES.map((g) => ({
              href: `/guides/${g.slug}`,
              title: g.title,
            }))}
          />
        </div>
      </section>
      </PageShell>
    </main>
  );
}
