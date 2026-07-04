import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
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
    <main className="min-h-screen bg-[var(--color-cream)]">
      <JsonLd data={BREADCRUMB_LD} />

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
          <Link href="/" aria-label="Taxottic home">
            <Wordmark size="md" tone="cream" />
          </Link>
          <SignInIconLink />
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-6">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Compare
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight">
          How Taxottic compares.
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-xl leading-relaxed">
          Straight comparisons, including where the other tools are the better
          choice. Taxottic is a year-round tax-forecasting companion; it&rsquo;s
          not a bookkeeping suite and it doesn&rsquo;t file your return. Here&rsquo;s
          where it fits.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 grid gap-4">
        {COMPARISONS.map((c) => (
          <Link
            key={c.slug}
            href={`/compare/${c.slug}`}
            className="card p-6 hover:border-gold-300 transition-colors"
          >
            <h2 className="display text-lg sm:text-xl text-forest-900">
              {c.title}
            </h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              {c.blurb}
            </p>
            <span className="mt-3 inline-block text-sm text-gold-800">
              Read the comparison →
            </span>
          </Link>
        ))}
      </section>
    </main>
  );
}
