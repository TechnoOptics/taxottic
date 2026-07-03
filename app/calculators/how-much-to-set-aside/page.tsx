import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";
import { SetAsideCalculator } from "@/components/calculators/SetAsideCalculator";
import type { FilingStatus } from "@/lib/tax/constants-2025";
import { buildCalcMetadata, readSearch, type Search } from "@/lib/calculators/page-meta";

const SITE = "https://taxottic.com";
const SLUG = "how-much-to-set-aside";
const TITLE = "How Much to Set Aside for Taxes (Self-Employed) — Calculator";
const DESCRIPTION =
  "Free calculator: how much of every payment to set aside for taxes when you're self-employed. Get the exact percentage — covering self-employment tax plus federal & state income tax. No sign-up.";
const KEYWORDS = [
  "how much to set aside for taxes",
  "how much to save for taxes self employed",
  "tax set aside calculator",
  "what percent to save for taxes 1099",
  "self employed tax savings calculator",
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
    calc: "set-aside",
    sp,
    ogKeys: ["income", "expenses", "filing", "state"],
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
      name: "How Much to Set Aside for Taxes",
      item: `${SITE}/calculators/${SLUG}`,
    },
  ],
};

const APP_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "How Much to Set Aside for Taxes Calculator",
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
      name: "What percentage should I set aside for taxes if I'm self-employed?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A common starting point is 25–30% of your income, but the right number depends on how much you make, your filing status, and your state. It has to cover self-employment tax (15.3%) plus federal and state income tax. Enter your numbers above for your exact percentage instead of a rule of thumb.",
      },
    },
    {
      "@type": "Question",
      name: "Should I set aside a percentage of gross or net income?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The easiest habit is a percentage of each gross payment as it lands, before you've tallied expenses — that's the number this calculator gives. It slightly over-saves, which is a feature: you'd rather end the year with a small cushion than a shortfall.",
      },
    },
    {
      "@type": "Question",
      name: "Where should I keep the money I set aside?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "In a separate high-yield savings account you don't touch, moving your set-aside percentage over the moment each payment clears. Keeping it out of your checking account is the single most effective way to make sure it's there when quarterly taxes are due.",
      },
    },
  ],
};

export default async function SetAsidePage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const s = readSearch(await searchParams);
  const initial = {
    income: s.income,
    expenses: s.expenses,
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
          <Link href="/" aria-label="Taxottic home">
            <Wordmark size="md" tone="cream" />
          </Link>
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
          <span className="text-forest-800">How much to set aside</span>
        </nav>
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700 mt-6">
          Free calculator · 2026
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight max-w-3xl">
          How much should I set aside for taxes?
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
          A simple rule you can apply to every payment: the exact percentage to
          move into savings so quarterly taxes are covered and April is calm.
          Instant, no sign-up.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <SetAsideCalculator initial={initial} />
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8 grid gap-8">
        <div>
          <h2 className="display text-2xl text-forest-900">
            Why a set-aside habit beats a shoebox
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            The reason self-employment taxes feel brutal isn&rsquo;t the rate —
            it&rsquo;s the timing. No employer withholds anything, so the whole
            bill lands at once unless you&rsquo;ve been quietly setting money
            aside all year. The fix is a single number: a percentage of every
            payment that goes straight into a separate savings account the
            moment it clears. Do that, and quarterly taxes stop being an event —
            the money&rsquo;s already there. This calculator gives you the
            percentage for your income, filing status, and state, covering both{" "}
            <strong className="text-forest-800">self-employment tax</strong> and{" "}
            <strong className="text-forest-800">income tax</strong>.
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
                href="/guides/self-employment-tax-how-much-to-set-aside"
                className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
              >
                How much to set aside for self-employment tax (full guide)
              </Link>
            </li>
            <li>
              <Link
                href="/calculators/quarterly-estimated-tax"
                className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
              >
                Quarterly estimated tax calculator
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
