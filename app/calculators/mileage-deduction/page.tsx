import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";
import { MileageDeductionCalculator } from "@/components/calculators/MileageDeductionCalculator";
import { buildCalcMetadata, readSearch, type Search } from "@/lib/calculators/page-meta";

const SITE = "https://taxottic.com";
const SLUG = "mileage-deduction";
const TITLE = "Mileage Deduction Calculator (2026), Free, IRS Rate";
const DESCRIPTION =
  "Free business mileage deduction calculator using the 2026 IRS standard mileage rate (70¢/mile). See your deduction and estimated tax savings from business miles, no sign-up.";
const KEYWORDS = [
  "mileage deduction calculator",
  "IRS mileage calculator",
  "business mileage calculator",
  "mileage tax deduction calculator",
  "2026 mileage rate calculator",
  "self employed mileage deduction",
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
    calc: "mileage",
    sp,
    ogKeys: ["miles", "rate"],
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
      name: "Mileage Deduction Calculator",
      item: `${SITE}/calculators/${SLUG}`,
    },
  ],
};

const APP_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Mileage Deduction Calculator",
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
      name: "What is the 2026 IRS mileage rate?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The 2026 IRS standard mileage rate for business use is 70 cents per mile. You multiply your business miles by that rate to get your deduction, it's meant to cover gas, maintenance, insurance, and depreciation, so you don't have to track every actual car expense.",
      },
    },
    {
      "@type": "Question",
      name: "Which miles can I deduct?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Miles driven for business, client visits, job sites, business errands, driving between work locations, and trips to the bank or supplier for the business. Your regular commute from home to a fixed workplace is not deductible. Keep a log with the date, miles, and purpose; the IRS can ask for it.",
      },
    },
    {
      "@type": "Question",
      name: "Standard mileage rate or actual expenses, which is better?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The standard mileage rate (this calculator) is simplest and usually wins for higher-mileage, fuel-efficient vehicles. The actual-expense method (tracking gas, repairs, insurance, depreciation, and applying your business-use percentage) can be larger for expensive vehicles or low mileage. If you want the standard rate, you generally must choose it the first year you use the car for business.",
      },
    },
    {
      "@type": "Question",
      name: "How much does the mileage deduction actually save me?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The deduction lowers your taxable income, so your saving is the deduction times your marginal tax rate. For a self-employed driver it reduces both self-employment tax and income tax, often 25-40 cents saved per dollar deducted. Pick your situation above for an estimate.",
      },
    },
  ],
};

export default async function MileageDeductionCalculatorPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const s = readSearch(await searchParams);
  const initial = { miles: s.miles, rate: s.rate };
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
          <span className="text-forest-800">Mileage deduction</span>
        </nav>
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700 mt-6">
          Free calculator · 2026
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight max-w-3xl">
          Mileage Deduction Calculator
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
          Turn your business miles into a tax deduction at the 2026 IRS rate -
          and see roughly what it saves you. Instant, no sign-up.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <MileageDeductionCalculator initial={initial} />
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8 grid gap-8">
        <div>
          <h2 className="display text-2xl text-forest-900">
            The mileage deduction, simply
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            If you drive for work, the IRS lets you deduct a flat rate for every
            business mile -{" "}
            <strong className="text-forest-800">70¢ per mile in 2026</strong> -
            instead of itemizing gas, repairs, insurance, and depreciation. It&rsquo;s
            one of the most valuable and most under-claimed deductions for
            freelancers, contractors, real-estate agents, delivery and rideshare
            drivers, and anyone who uses their own car for business. The only
            catch: you need a{" "}
            <strong className="text-forest-800">contemporaneous log</strong> -
            date, miles, and purpose for each trip, because a reconstructed
            guess doesn&rsquo;t survive an audit. That&rsquo;s exactly the part
            Taxottic automates.
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
                href="/guides/business-mileage-deduction"
                className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
              >
                The business mileage deduction (full guide)
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
