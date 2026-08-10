import { MarketingNav } from "@/components/MarketingNav";
import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";
import { EffectiveTaxRateCalculator } from "@/components/calculators/EffectiveTaxRateCalculator";
import type { FilingStatus } from "@/lib/tax/constants-2025";
import { buildCalcMetadata, readSearch, type Search } from "@/lib/calculators/page-meta";

const SITE = "https://taxottic.com";
const SLUG = "effective-tax-rate";
const TITLE = "Effective Tax Rate Calculator (2026), Free";
const DESCRIPTION =
  "Free effective tax rate calculator. See what you actually pay across all your income, effective rate, marginal bracket, total tax, and after-tax take-home, for W-2 or self-employment income. No sign-up.";
const KEYWORDS = [
  "effective tax rate calculator",
  "marginal tax rate calculator",
  "what is my tax rate",
  "average tax rate calculator",
  "after tax income calculator",
  "tax bracket calculator",
];

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Search;
}): Promise<Metadata> {
  const sp = await searchParams;
  return buildCalcMetadata({
    slug: SLUG,
    title: TITLE,
    description: DESCRIPTION,
    keywords: KEYWORDS,
    calc: "effective",
    sp,
    ogKeys: ["income", "type", "filing", "state"],
  });
}

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
    {
      "@type": "ListItem",
      position: 3,
      name: "Effective Tax Rate Calculator",
      item: `${SITE}/calculators/${SLUG}`,
    },
  ],
};

const APP_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Effective Tax Rate Calculator",
  url: `${SITE}/calculators/${SLUG}`,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Any (web)",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  description: DESCRIPTION,
  publisher: { "@id": `${SITE}/#organization` },
  inLanguage: "en-US",
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What's the difference between effective and marginal tax rate?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Your effective tax rate is your total tax divided by your total income, the real percentage you pay overall. Your marginal rate is the rate on your next dollar of income, i.e. the top bracket you reach. Because the US uses progressive brackets, your effective rate is always lower than your marginal rate.",
      },
    },
    {
      "@type": "Question",
      name: "Why is my effective tax rate lower than my tax bracket?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Only the income in each bracket is taxed at that bracket's rate, your first dollars are taxed at the lowest rate, and only the income above each threshold is taxed higher. Add the standard deduction (which is taxed at 0%) and your average, or effective, rate ends up well below the marginal bracket you're 'in.'",
      },
    },
    {
      "@type": "Question",
      name: "Does this include state tax?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, pick your state and the effective rate reflects federal plus state income tax. For self-employment income it also includes self-employment tax, which is why a self-employed effective rate runs higher than a W-2 salary at the same income.",
      },
    },
  ],
};

export default async function EffectiveTaxRatePage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const s = readSearch(await searchParams);
  const initial = {
    income: s.income,
    type: s.type === "self" ? ("self" as const) : undefined,
    filing: s.filing as FilingStatus | undefined,
    state: s.state,
  };
  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <JsonLd data={BREADCRUMB_LD} />
      <JsonLd data={APP_LD} />
      <JsonLd data={FAQ_LD} />

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
          <MarketingNav current="calculators" />
          <SignInIconLink />
        </div>
      </header>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-2">
        <nav
          aria-label="Breadcrumb"
          className="text-xs text-ink-muted flex items-center gap-1.5"
        >
          <Link href="/" className="hover:text-forest-900">
            Home
          </Link>
          <span aria-hidden="true">/</span>
          <Link href="/calculators" className="hover:text-forest-900">
            Calculators
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-forest-800">Effective tax rate</span>
        </nav>
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700 mt-6">
          Free calculator · 2026
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight max-w-3xl">
          Effective Tax Rate Calculator
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
          See what you actually pay, your effective rate across all your
          income, the marginal bracket on your next dollar, and your after-tax
          take-home. Works for a W-2 salary or self-employment income. Instant,
          no sign-up.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <EffectiveTaxRateCalculator initial={initial} />
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8 grid gap-8">
        <div>
          <h2 className="display text-2xl text-forest-900">
            Effective vs. marginal, why it matters
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            People say they&rsquo;re &ldquo;in the 24% bracket&rdquo; and assume
            they pay 24% of everything, but that&rsquo;s the{" "}
            <strong className="text-forest-800">marginal</strong> rate, the tax
            on the last dollar. Your{" "}
            <strong className="text-forest-800">effective</strong> rate, total
            tax over total income, is what you really pay, and it&rsquo;s always
            lower, because the brackets stack: your first dollars are taxed
            least, the standard deduction is taxed at zero, and only income
            above each threshold gets the higher rate. Knowing both is useful:
            the effective rate tells you your true burden; the marginal rate
            tells you what a raise, a bonus, or an extra contract will actually
            be taxed at.
          </p>
        </div>

        <div>
          <h2 className="display text-2xl text-forest-900">Frequently asked</h2>
          <div className="mt-4 grid gap-4">
            {FAQ_LD.mainEntity.map((qa) => (
              <div key={qa.name} className="card p-5">
                <h3 className="text-base font-medium text-forest-900">
                  {qa.name}
                </h3>
                <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                  {qa.acceptedAnswer.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="card p-6 border-gold-300/60">
          <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
            Keep going
          </div>
          <h2 className="display text-xl text-forest-900 mt-1">
            Related guides &amp; tools
          </h2>
          <ul className="mt-3 grid gap-2 text-sm">
            <li>
              <Link
                href="/guides/1099-vs-w2"
                className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
              >
                1099 vs W-2: how your taxes actually differ
              </Link>
            </li>
            <li>
              <Link
                href="/calculators/self-employment-tax"
                className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
              >
                Self-employment tax calculator
              </Link>
            </li>
            <li>
              <Link
                href="/guides/quarterly-estimated-taxes-explained"
                className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
              >
                Quarterly estimated taxes, explained
              </Link>
            </li>
            <li>
              <Link
                href="/calculators/how-much-to-set-aside"
                className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
              >
                How much to set aside for taxes
              </Link>
            </li>
            <li>
              <Link
                href="/calculators"
                className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
              >
                All free tax calculators →
              </Link>
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}
