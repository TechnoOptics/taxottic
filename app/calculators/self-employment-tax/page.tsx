import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";
import { SelfEmploymentTaxCalculator } from "@/components/calculators/SelfEmploymentTaxCalculator";

const SITE = "https://taxottic.com";
const SLUG = "self-employment-tax";
const TITLE = "Self-Employment Tax Calculator (2026) — Free & Instant";
const DESCRIPTION =
  "Free self-employment tax calculator. Estimate your 2026 self-employment tax (15.3%), federal & state income tax, QBI deduction, and quarterly payments from your 1099 income — no sign-up. Runs the same IRS-aligned engine as Taxottic.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/calculators/${SLUG}` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `/calculators/${SLUG}`,
    type: "website",
  },
  keywords: [
    "self-employment tax calculator",
    "1099 tax calculator",
    "self employed tax calculator",
    "SE tax calculator",
    "freelance tax calculator",
    "quarterly estimated tax calculator",
    "how much self employment tax will I owe",
  ],
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
      name: "Self-Employment Tax Calculator",
      item: `${SITE}/calculators/${SLUG}`,
    },
  ],
};

// WebApplication (calculator) schema → makes the page eligible for the
// interactive-tool rich result and tells AI assistants this is a usable
// tool, not just an article.
const APP_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Self-Employment Tax Calculator",
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
      name: "How much is self-employment tax?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Self-employment tax is 15.3% of your net self-employment earnings — 12.4% for Social Security (up to the annual wage base) plus 2.9% for Medicare (no cap). It's calculated on 92.35% of your net profit, and you can deduct half of it as an above-the-line adjustment. This calculator applies all of that automatically, then adds your federal and state income tax on top so you see the full picture.",
      },
    },
    {
      "@type": "Question",
      name: "Is this self-employment tax calculator accurate?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "It runs the same forecasting engine Taxottic uses inside the paid app — current-year federal brackets, the Social Security wage base, the QBI (Section 199A) deduction, the extra 0.9% Medicare surcharge, and your state's brackets. It's an estimate for planning, not a filed return, and not a substitute for a licensed CPA.",
      },
    },
    {
      "@type": "Question",
      name: "Do I have to pay quarterly estimated taxes?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "If you expect to owe $1,000 or more when you file, the IRS generally wants estimated payments four times a year (mid-April, mid-June, mid-September, and mid-January). This calculator shows your next quarterly amount and due date so you can set the money aside before it's due.",
      },
    },
    {
      "@type": "Question",
      name: "What counts as self-employment income?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Net profit from freelancing, contracting, gig work, a single-member LLC, or a sole proprietorship — generally the income on your 1099-NEC/1099-K minus your ordinary and necessary business expenses. Enter your gross income and expenses above and the calculator uses the net profit.",
      },
    },
  ],
};

export default function SelfEmploymentTaxCalculatorPage() {
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

      {/* Hero */}
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
          <span className="text-forest-800">Self-employment tax</span>
        </nav>
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700 mt-6">
          Free calculator · 2026
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight max-w-3xl">
          Self-Employment Tax Calculator
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
          See what you&rsquo;ll actually owe on your 1099 income — self-employment
          tax, federal and state income tax, your QBI deduction, and your next
          quarterly payment. Instant, no sign-up, and it runs the same
          IRS-aligned engine as Taxottic.
        </p>
      </section>

      {/* Calculator */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <SelfEmploymentTaxCalculator />
      </section>

      {/* Supporting content — real substance for ranking + humans */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8 grid gap-8">
        <div>
          <h2 className="display text-2xl text-forest-900">
            How self-employment tax works
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            When you work for yourself, no employer splits your payroll taxes
            with you — so you cover both halves. That&rsquo;s{" "}
            <strong className="text-forest-800">self-employment tax</strong>:
            15.3% of your net earnings, made up of 12.4% Social Security (up to
            the annual wage base) and 2.9% Medicare (no cap). It&rsquo;s figured
            on 92.35% of your net profit, and you get to deduct half of it
            before income tax. On top of that sits your{" "}
            <strong className="text-forest-800">federal income tax</strong> (at
            your bracket), your{" "}
            <strong className="text-forest-800">state income tax</strong> if
            your state has one, minus the{" "}
            <strong className="text-forest-800">QBI deduction</strong> that
            shaves up to 20% off your qualified business income. This calculator
            does all of it — most free calculators only show the flat 15.3%
            slice.
          </p>
        </div>

        <div>
          <h2 className="display text-2xl text-forest-900">
            Frequently asked
          </h2>
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
                How much should I set aside for self-employment tax?
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
                href="/guides/schedule-c-deductions"
                className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
              >
                Schedule C deductions you can write off
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
