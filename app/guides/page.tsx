import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { JsonLd } from "@/components/seo/JsonLd";

export const metadata = {
  title: "Guides — self-employment taxes, deductions & quarterly estimates",
  description:
    "Plain-English guides for freelancers and small businesses: how much to set aside for self-employment tax, Schedule C deductions you can claim, and how quarterly estimated taxes work.",
  alternates: { canonical: "/guides" },
  openGraph: {
    title: "Taxottic Guides",
    description:
      "Plain-English guides on self-employment tax, deductions, and quarterly estimates — no sign-in required.",
    url: "/guides",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large" },
  },
};

const SITE = "https://taxottic.com";

// Each guide is a real article page under /guides/<slug>. Keep this
// list in sync with the route folders; it drives both the visible cards
// and the ItemList structured data.
const GUIDES = [
  {
    slug: "self-employment-tax-how-much-to-set-aside",
    title: "How much should I set aside for taxes when self-employed?",
    blurb:
      "A simple way to size your tax set-aside — self-employment tax plus income tax — and why a flat percentage of every payment keeps April calm.",
  },
  {
    slug: "schedule-c-deductions",
    title: "Schedule C deductions: what self-employed people can write off",
    blurb:
      "The everyday business expenses that lower your taxable income — home office, mileage, software, phone, and more — each tied to its IRS source.",
  },
  {
    slug: "quarterly-estimated-taxes-explained",
    title: "Quarterly estimated taxes, explained",
    blurb:
      "Who owes them, the four due dates, how to estimate each payment, and how to avoid the underpayment penalty.",
  },
  {
    slug: "home-office-deduction",
    title: "Home office deduction: who qualifies and how to calculate it",
    blurb:
      "The 'regular and exclusive use' test, plus the simplified ($5/sq ft) and actual-expense methods compared.",
  },
  {
    slug: "1099-vs-w2",
    title: "1099 vs W-2: how each affects your taxes",
    blurb:
      "Who withholds, who pays the full 15.3% self-employment tax, who can deduct expenses, and who owes quarterly estimates.",
  },
  {
    slug: "first-year-freelancer-tax-checklist",
    title: "Your first year freelancing: a tax checklist",
    blurb:
      "A do-this-now list: set money aside, separate your finances, track deductions, and pay quarterly so April is boring.",
  },
  {
    slug: "sole-proprietor-vs-llc-vs-s-corp-taxes",
    title: "Sole proprietor, LLC, or S-corp: how each is taxed",
    blurb:
      "Pass-through income, self-employment tax, and when an S-corp salary-plus-distributions setup actually saves money.",
  },
];

const BREADCRUMB_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE}/guides` },
  ],
};

const ITEMLIST_LD = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: "Taxottic guides",
  itemListElement: GUIDES.map((g, i) => ({
    "@type": "ListItem",
    position: i + 1,
    url: `${SITE}/guides/${g.slug}`,
    name: g.title,
  })),
};

export default function GuidesIndex() {
  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <JsonLd data={BREADCRUMB_LD} />
      <JsonLd data={ITEMLIST_LD} />

      <header
        className="relative"
        style={{
          background:
            "linear-gradient(180deg, #2a3a5e 0%, #1d2843 60%, #121a2a 100%)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="Taxottic home">
            <Wordmark size="md" tone="cream" />
          </Link>
          <Link href="/login" className="text-sm text-cream/80 hover:text-cream">
            Sign in
          </Link>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-6">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Guides
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight">
          Self-employment taxes, in plain English.
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-xl leading-relaxed">
          Short, practical guides for freelancers, contractors, and small
          businesses — what to set aside, what you can deduct, and how
          quarterly taxes work. Written by the team behind Taxottic.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 grid gap-4">
        {GUIDES.map((g) => (
          <Link
            key={g.slug}
            href={`/guides/${g.slug}`}
            className="card p-6 hover:border-gold-300 transition-colors"
          >
            <h2 className="display text-lg sm:text-xl text-forest-900">
              {g.title}
            </h2>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              {g.blurb}
            </p>
            <span className="mt-3 inline-block text-sm text-gold-800">
              Read the guide →
            </span>
          </Link>
        ))}
      </section>
    </main>
  );
}
