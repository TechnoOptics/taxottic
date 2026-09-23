import { PageShell } from "@/components/marketing/PageShell";
import { LedgerList } from "@/components/marketing/LedgerList";
import { JsonLd } from "@/components/seo/JsonLd";

const SITE = "https://taxottic.com";
const TITLE = "Compare Taxottic to Other Self-Employed Tax Tools";
const DESCRIPTION =
  "Honest comparisons of Taxottic, a year-round tax-forecasting companion for freelancers and small businesses, against the tools you already know.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/compare" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "/compare",
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

const COMPARISONS = [
  {
    slug: "quickbooks-self-employed-alternative",
    title: "QuickBooks Self-Employed alternative",
    blurb:
      "QuickBooks Self-Employed is being retired for Solopreneur. Where a forecasting-first tool fits if you care most about what you'll owe.",
  },
  {
    slug: "keeper-alternative",
    title: "Keeper alternative",
    blurb:
      "Keeper files and tracks deductions; Taxottic forecasts and cites them, for less. Where the two part ways, honestly.",
  },
];

const BREADCRUMB_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "Compare", item: `${SITE}/compare` },
  ],
};

export default function CompareHubPage() {
  return (
    <main data-grammar="year" className="min-h-screen bg-[var(--color-cream)]">
      <PageShell current="compare">
      <JsonLd data={BREADCRUMB_LD} />


      <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-6">
        <h1 className="display text-4xl sm:text-6xl text-forest-900 leading-tight">
          How Taxottic compares.
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-xl leading-relaxed">
          Straight comparisons, including where the other tools are the better
          choice. Taxottic is a year-round tax-forecasting companion; it&rsquo;s
          not a bookkeeping suite and it doesn&rsquo;t file your return. Here&rsquo;s
          where it fits.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-16">
        <LedgerList
          ariaLabel="Comparisons"
          items={COMPARISONS.map((c) => ({
            href: `/compare/${c.slug}`,
            title: c.title,
            blurb: c.blurb,
          }))}
        />
      </section>
      </PageShell>
    </main>
  );
}
