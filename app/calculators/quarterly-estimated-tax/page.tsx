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
const SLUG = "quarterly-estimated-tax";
const TITLE = "Quarterly Estimated Tax Calculator (2026), Free";
const DESCRIPTION =
  "Free quarterly estimated tax calculator. Estimate your 2026 IRS quarterly payments from your self-employment income, all four due dates, federal + state, self-employment tax, and QBI. No sign-up.";
const KEYWORDS = [
  "quarterly estimated tax calculator",
  "estimated tax calculator",
  "quarterly tax calculator",
  "IRS estimated payments calculator",
  "self employed quarterly tax calculator",
  "1040-ES calculator",
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
    calc: "quarterly",
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
      name: "Quarterly Estimated Tax Calculator",
      item: `${SITE}/calculators/${SLUG}`,
    },
  ],
};

const APP_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Quarterly Estimated Tax Calculator",
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
      name: "Who has to pay quarterly estimated taxes?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Generally anyone who expects to owe $1,000 or more at filing time and doesn't have enough tax withheld, most freelancers, 1099 contractors, gig workers, sole proprietors, and small-business owners. If all your income is W-2 with adequate withholding, you usually don't need to.",
      },
    },
    {
      "@type": "Question",
      name: "When are quarterly estimated taxes due in 2026?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The four federal deadlines are roughly April 15, June 15, September 15, and January 15 of the following year. They don't line up with calendar quarters, Q2 covers only two months, so it's easy to under-save for the June payment. This calculator shows each due date with the amount to send.",
      },
    },
    {
      "@type": "Question",
      name: "How do I avoid the underpayment penalty?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The safe harbor: pay at least 90% of this year's tax, or 100% of last year's tax (110% if your prior-year AGI was over $150,000), spread across the four quarters. Hit the safe harbor and the IRS won't charge an underpayment penalty even if you owe more at filing.",
      },
    },
    {
      "@type": "Question",
      name: "How is each quarterly payment calculated?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Estimate your total tax for the year, self-employment tax plus federal and state income tax, minus credits and any withholding, then divide across the remaining quarters. This calculator does the full-year estimate first, then splits it into the four payments for you.",
      },
    },
  ],
};

export default async function QuarterlyEstimatedTaxCalculatorPage({
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
          <span className="text-forest-800">Quarterly estimated tax</span>
        </nav>
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700 mt-6">
          Free calculator · 2026
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight max-w-3xl">
          Quarterly Estimated Tax Calculator
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
          Work out what to send the IRS each quarter on your self-employment
          income, all four payments, each due date, federal and state, so you
          set the money aside before it&rsquo;s due and dodge the underpayment
          penalty. Instant, no sign-up.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <SelfEmploymentTaxCalculator showFullQuarterlySchedule initial={initial} />
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8 grid gap-8">
        <div>
          <h2 className="display text-2xl text-forest-900">
            Why quarterly taxes trip people up
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            When you&rsquo;re self-employed, no employer withholds tax from your
            pay, so the IRS asks you to send it in four times a year instead.
            The catch: the deadlines don&rsquo;t match calendar quarters (the
            second &ldquo;quarter&rdquo; is only two months long), and if you
            under-pay, you can owe an{" "}
            <strong className="text-forest-800">underpayment penalty</strong> on
            top of the tax. The fix is boring but bulletproof, estimate the
            year, hit the{" "}
            <strong className="text-forest-800">safe harbor</strong> (90% of
            this year or 100-110% of last year), and move a fixed slice of every
            payment into savings so the money&rsquo;s already there when the due
            date lands.
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
                href="/guides/quarterly-estimated-taxes-explained"
                className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
              >
                Quarterly estimated taxes, explained
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
                href="/guides/self-employment-tax-how-much-to-set-aside"
                className="text-gold-800 hover:text-gold-900 underline underline-offset-2"
              >
                How much to set aside for self-employment tax
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
