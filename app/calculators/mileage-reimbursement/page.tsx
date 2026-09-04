import { MarketingNav } from "@/components/MarketingNav";
import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";
import { MileageReimbursementCalculator } from "@/components/calculators/MileageReimbursementCalculator";
import { buildCalcMetadata, readSearch, type Search } from "@/lib/calculators/page-meta";
import { ratePeriodsForYear } from "@/lib/calculators/mileage-reimbursement";

const SITE = "https://taxottic.com";
const SLUG = "mileage-reimbursement";
const TAX_YEAR = 2026;

// Rates are read, never typed. lib/tax/rate-copy.test.ts enforces it,
// and the reason is that four public strings on the sibling mileage
// calculator went stale by 2.5 cents and nobody noticed for two months.
const PERIODS = ratePeriodsForYear(TAX_YEAR);
const RATE_LABEL =
  PERIODS.length > 1
    ? `${PERIODS[0].centsPerMile}¢ then ${PERIODS[1].centsPerMile}¢ per mile`
    : `${PERIODS[0].centsPerMile}¢ per mile`;
const RATE_SENTENCE =
  PERIODS.length > 1
    ? `For ${TAX_YEAR} the IRS standard mileage rate changed mid-year: ${PERIODS[0].centsPerMile} cents per mile through June 30, then ${PERIODS[1].centsPerMile} cents per mile from July 1.`
    : `For ${TAX_YEAR} the IRS standard mileage rate is ${PERIODS[0].centsPerMile} cents per mile.`;

const TITLE = `Employee Mileage Reimbursement Calculator (${TAX_YEAR}), Free`;
const DESCRIPTION = `Free employee mileage reimbursement calculator. Work out what reimbursing your team's business driving costs for ${TAX_YEAR} at the IRS standard rate (${RATE_LABEL}), and the net cost after the deduction. No sign-up.`;
const KEYWORDS = [
  "mileage reimbursement calculator",
  "employee mileage reimbursement",
  "irs mileage reimbursement rate 2026",
  "how much to reimburse employees for mileage",
  "company mileage reimbursement cost",
  "accountable plan mileage reimbursement",
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
    ogKeys: ["drivers", "miles", "rate"],
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
      name: "Mileage Reimbursement Calculator",
      item: `${SITE}/calculators/${SLUG}`,
    },
  ],
};

const APP_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "Employee Mileage Reimbursement Calculator",
  url: `${SITE}/calculators/${SLUG}`,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Any (web)",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  description: DESCRIPTION,
  publisher: { "@id": `${SITE}/#organization` },
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: `What is the ${TAX_YEAR} IRS mileage reimbursement rate?`,
      acceptedAnswer: {
        "@type": "Answer",
        text: `${RATE_SENTENCE} Employers commonly reimburse at that rate because it is the ceiling for tax-free reimbursement under an accountable plan.`,
      },
    },
    {
      "@type": "Question",
      name: "Are employers required to reimburse employee mileage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "There is no federal requirement to reimburse mileage, though some states do require reimbursement of necessary business expenses. Check your state, and note that federal law still applies where unreimbursed costs would take an employee below minimum wage.",
      },
    },
    {
      "@type": "Question",
      name: "Is mileage reimbursement taxable to the employee?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Not if it is paid under an accountable plan at or below the IRS standard rate: the employee substantiates the business miles, returns any excess, and the reimbursement is neither reported as wages nor subject to payroll tax. Pay above the standard rate, or without substantiation, and the excess becomes taxable wages.",
      },
    },
    {
      "@type": "Question",
      name: "Is the reimbursement deductible for the business?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Mileage reimbursed under an accountable plan is an ordinary and necessary business expense, deductible like any other. The calculator shows the net cost after that deduction at the rate you select.",
      },
    },
    {
      "@type": "Question",
      name: "Does an employee commute count?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. Travel between home and a regular workplace is a personal commuting expense, not business mileage, so it is not reimbursable tax-free at the standard rate. Driving between worksites, to clients, or to a temporary work location during the day does count.",
      },
    },
    {
      "@type": "Question",
      name: "What records does the IRS expect?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A contemporaneous log: the date, the business purpose, and the miles for each trip. Records made at the time carry far more weight than a figure reconstructed at year end. See IRS Publication 463.",
      },
    },
  ],
};

export default async function Page({ searchParams }: { searchParams: Search }) {
  const s = readSearch(await searchParams);
  const initial = { drivers: s.drivers, miles: s.miles, rate: s.rate };

  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <JsonLd data={BREADCRUMB_LD} />
      <JsonLd data={APP_LD} />
      <JsonLd data={FAQ_LD} />

      <header
        className="relative"
        style={{
          background:
            "var(--navy-band)",
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

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14">
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
          <span className="text-forest-800">Mileage reimbursement</span>
        </nav>

        <div className="mt-4 text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
          Free calculator · {TAX_YEAR}
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight max-w-3xl">
          Employee Mileage Reimbursement Calculator
        </h1>
        <p className="mt-4 text-base sm:text-lg text-ink-soft max-w-2xl leading-relaxed">
          Work out what reimbursing your team&rsquo;s business driving costs
          for the year at the IRS standard rate, and what it costs after the
          deduction. Instant, no sign-up.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <MileageReimbursementCalculator initial={initial} />
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8 grid gap-8">
        <div>
          <h2 className="display text-2xl text-forest-900">
            Reimbursing mileage, in plain terms
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            When an employee drives their own car for work, you can pay them
            back per mile. {RATE_SENTENCE} Pay at or below that rate under an{" "}
            <strong className="text-forest-800">accountable plan</strong>, and
            two useful things happen at once: the payment is a deductible
            business expense for you, and it is not wages for them, so there
            is no income tax and no payroll tax on either side.
          </p>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            An accountable plan is not paperwork for its own sake. It means
            three things: the expense is business-related, the employee
            substantiates it within a reasonable time, and anything paid in
            excess is returned. Miss those and the whole amount can be
            recharacterised as taxable wages, which is the expensive outcome
            this page exists to help you avoid.
          </p>
        </div>

        <div>
          <h2 className="display text-2xl text-forest-900">
            The part that goes wrong
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            Substantiation. The rate is the easy half; the records are the
            half that fails. The IRS expects a contemporaneous log, meaning
            the date, the business purpose and the miles captured at the time
            rather than a total assembled in April from memory and a fuel
            card. A reconstructed estimate is exactly what gets disallowed.
          </p>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            That is the whole reason Taxottic records drives automatically by
            GPS, per driver, with a map attached. See{" "}
            <Link
              href="/guides/business-mileage-deduction"
              className="text-gold-700 underline underline-offset-2 hover:text-forest-900"
            >
              the mileage deduction guide
            </Link>{" "}
            for how the log is meant to look, or the{" "}
            <Link
              href="/calculators/mileage-deduction"
              className="text-gold-700 underline underline-offset-2 hover:text-forest-900"
            >
              personal mileage deduction calculator
            </Link>{" "}
            if you are self-employed rather than reimbursing staff.
          </p>
        </div>

        <div>
          <h2 className="display text-2xl text-forest-900">
            Common questions
          </h2>
          <dl className="mt-4 grid gap-5">
            {FAQ_LD.mainEntity.map((q) => (
              <div key={q.name}>
                <dt className="text-sm sm:text-base font-medium text-forest-800">
                  {q.name}
                </dt>
                <dd className="mt-1.5 text-sm text-ink-soft leading-relaxed">
                  {q.acceptedAnswer.text}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <p className="text-xs text-ink-muted leading-relaxed">
          This calculator is for planning and is not tax advice. Figures are
          estimates based on the IRS standard mileage rate and the marginal
          rate you select. State reimbursement requirements vary. Confirm your
          situation with a licensed CPA, and see IRS Publication 463 for the
          substantiation rules.
        </p>
      </section>
    </main>
  );
}
