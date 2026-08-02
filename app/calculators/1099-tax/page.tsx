import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  SelfEmploymentTaxCalculator,
  type SETaxInitial,
} from "@/components/calculators/SelfEmploymentTaxCalculator";
import { buildCalcMetadata, readSearch, type Search } from "@/lib/calculators/page-meta";

const SITE = "https://taxottic.com";
const SLUG = "1099-tax";
const TITLE = "1099 Tax Calculator (2026), Free for Contractors";
const DESCRIPTION =
  "Free 1099 tax calculator for independent contractors, gig workers, and freelancers. Estimate your 2026 tax on 1099-NEC / 1099-K income, self-employment tax, federal + state, QBI, and quarterly payments. No sign-up.";
const KEYWORDS = [
  "1099 tax calculator",
  "1099 income tax calculator",
  "independent contractor tax calculator",
  "gig worker tax calculator",
  "1099-NEC tax calculator",
  "freelance tax calculator",
  "how much tax do I owe on 1099 income",
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
    calc: "1099",
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
      name: "1099 Tax Calculator",
      item: `${SITE}/calculators/${SLUG}`,
    },
  ],
};

const APP_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "1099 Tax Calculator",
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
      name: "How much tax do I owe on 1099 income?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "On 1099 income you owe self-employment tax (15.3% of net earnings for Social Security and Medicare) plus federal income tax at your bracket, plus state income tax if your state has one, reduced by the QBI deduction and your business write-offs. A rough rule of thumb is 25-30% of net profit set aside, but this calculator gives you the real number for your situation.",
      },
    },
    {
      "@type": "Question",
      name: "Do 1099 contractors pay more tax than W-2 employees?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "On the payroll-tax side, yes, a W-2 employee splits the 15.3% Social Security and Medicare tax with their employer, while a 1099 contractor pays both halves as self-employment tax. But contractors can deduct business expenses a W-2 employee usually can't, plus the QBI deduction and half of the self-employment tax, which claws a lot of it back.",
      },
    },
    {
      "@type": "Question",
      name: "What's the difference between a 1099-NEC and a 1099-K?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A 1099-NEC reports non-employee compensation a client paid you directly. A 1099-K reports payments processed through a platform or card processor (Stripe, PayPal, Uber, Etsy, etc.). Both are self-employment income, enter your total across all of them and subtract your business expenses.",
      },
    },
    {
      "@type": "Question",
      name: "Do I need to pay quarterly taxes on 1099 income?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "If you expect to owe $1,000 or more, the IRS generally wants quarterly estimated payments, nothing is withheld from a 1099 payment the way it is from a paycheck. This calculator shows your next quarterly amount and due date.",
      },
    },
  ],
};

export default async function TenNinetyNineTaxCalculatorPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  const s = readSearch(await searchParams);
  const initial: SETaxInitial = {
    income: s.income,
    expenses: s.expenses,
    filing: s.filing as SETaxInitial["filing"],
    state: s.state,
    w2: s.w2,
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
          <span className="text-forest-800">1099 tax</span>
        </nav>
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700 mt-6">
          Free calculator · 2026
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight max-w-3xl">
          1099 Tax Calculator
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
          Independent contractor, gig worker, or freelancer? See what you owe on
          your 1099-NEC and 1099-K income, self-employment tax, federal and
          state income tax, your QBI deduction, and your next quarterly payment.
          Instant, no sign-up.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <SelfEmploymentTaxCalculator initial={initial} />
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8 grid gap-8">
        <div>
          <h2 className="display text-2xl text-forest-900">
            What 1099 workers actually owe
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            A 1099 payment arrives with nothing taken out, no federal
            withholding, no Social Security, no Medicare. That&rsquo;s yours to
            handle, which is why a surprise bill in April is so common. Your tax
            has three layers:{" "}
            <strong className="text-forest-800">self-employment tax</strong>{" "}
            (15.3% for Social Security and Medicare, since you cover both the
            employee and employer halves),{" "}
            <strong className="text-forest-800">federal income tax</strong> at
            your bracket, and{" "}
            <strong className="text-forest-800">state income tax</strong> if you
            have it. The good news for contractors: your business expenses, the
            QBI deduction, and half of your self-employment tax all lower the
            bill, this calculator counts them so the number is the real one,
            not the scary one.
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
                href="/guides/what-is-a-1099-k"
                className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
              >
                What is a 1099-K?
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
