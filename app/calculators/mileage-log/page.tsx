import { MarketingNav } from "@/components/MarketingNav";
import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";
import { MileageLogBuilder } from "@/components/calculators/MileageLogBuilder";
import { ratePeriodsForYear } from "@/lib/calculators/mileage-reimbursement";

const SITE = "https://taxottic.com";
const SLUG = "mileage-log";
const TAX_YEAR = 2026;

const PERIODS = ratePeriodsForYear(TAX_YEAR);
const RATE_SENTENCE =
  PERIODS.length > 1
    ? `Each trip is priced at the rate in force on its own date: for ${TAX_YEAR} that is ${PERIODS[0].centsPerMile} cents per mile through June 30 and ${PERIODS[1].centsPerMile} cents from July 1.`
    : `Each trip is priced at the ${TAX_YEAR} IRS standard rate of ${PERIODS[0].centsPerMile} cents per mile.`;

const TITLE = `IRS Mileage Log Template and Generator (${TAX_YEAR}), Free`;
const DESCRIPTION = `Free IRS-compliant mileage log. Enter your business trips, get a log with the date, purpose and miles Publication 463 expects, priced at the ${TAX_YEAR} standard rate, and download it as CSV. Nothing is uploaded.`;
const KEYWORDS = [
  "mileage log template",
  "irs mileage log",
  "mileage log for taxes",
  "business mileage log",
  "free mileage log",
  "irs compliant mileage log",
  "mileage log requirements",
];

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: KEYWORDS,
  alternates: { canonical: `/calculators/${SLUG}` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `/calculators/${SLUG}`,
    type: "website",
    images: [
      {
        url: `/api/og/calc?calc=mileage&title=${encodeURIComponent("IRS Mileage Log")}`,
        width: 1200,
        height: 630,
      },
    ],
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
      name: "IRS Mileage Log",
      item: `${SITE}/calculators/${SLUG}`,
    },
  ],
};

const APP_LD = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: "IRS Mileage Log Generator",
  url: `${SITE}/calculators/${SLUG}`,
  applicationCategory: "FinanceApplication",
  operatingSystem: "Any (web)",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  description: DESCRIPTION,
  publisher: { "@id": `${SITE}/#organization` },
};

const HOWTO_LD = {
  "@context": "https://schema.org",
  "@type": "HowTo",
  name: `How to keep an IRS-compliant mileage log for ${TAX_YEAR}`,
  description:
    "The records IRS Publication 463 expects for a business mileage deduction, and how to produce them.",
  step: [
    {
      "@type": "HowToStep",
      name: "Record each trip at the time",
      text: "Write down the date, the business purpose, where you went and the miles when the trip happens. A record made at or near the time carries far more weight than a total assembled at year end.",
    },
    {
      "@type": "HowToStep",
      name: "Name the actual business purpose",
      text: "\"Client meeting, Acme quarterly review\" substantiates the trip. \"Work\" or \"errands\" does not, because it restates that the trip was for business without identifying it.",
    },
    {
      "@type": "HowToStep",
      name: "Leave out commuting",
      text: "Travel between home and a regular workplace is a personal commuting expense and is not deductible. Driving between worksites, to clients, or to a temporary work location during the day does count.",
    },
    {
      "@type": "HowToStep",
      name: "Apply the rate in force on each trip date",
      text: RATE_SENTENCE,
    },
    {
      "@type": "HowToStep",
      name: "Keep it with your return",
      text: "Retain the log with your tax records. You do not file it, but you need to be able to produce it if the deduction is questioned.",
    },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What does the IRS require in a mileage log?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "For each business trip: the date, the business purpose, and the mileage. Publication 463 asks for records made at or near the time of the trip, which is why a contemporaneous log carries far more weight than a figure reconstructed later. Recording where you went as well makes the entry easier to defend.",
      },
    },
    {
      "@type": "Question",
      name: "Does a reconstructed mileage log count?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "It is materially weaker. The standard is a record made at or near the time of the trip, so a total assembled at year end from memory, a calendar and a fuel card is the kind of substantiation that gets challenged. Rebuild what you genuinely can from contemporaneous evidence, and keep a proper log going forward.",
      },
    },
    {
      "@type": "Question",
      name: "Do I need to record odometer readings?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The requirement is the mileage for each business trip, not a start and end odometer reading per trip. You do need your total mileage for the year for Form 4562 or Schedule C, so noting the odometer at the start and end of the year is worth doing.",
      },
    },
    {
      "@type": "Question",
      name: "Is a mileage app acceptable to the IRS?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. There is no required format. What matters is that the record is timely, complete and accurate, which is exactly what an automatic GPS log produces, and it is contemporaneous by construction rather than by discipline.",
      },
    },
    {
      "@type": "Question",
      name: "How long should I keep it?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Keep it as long as the return it supports can be examined, which is generally three years from filing, and longer in some circumstances. Store it with that year's records rather than on the phone that produced it.",
      },
    },
  ],
};

export default function Page() {
  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <JsonLd data={BREADCRUMB_LD} />
      <JsonLd data={APP_LD} />
      <JsonLd data={HOWTO_LD} />
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
          <Link href="/" className="hover:text-forest-900">Home</Link>
          <span aria-hidden="true">/</span>
          <Link href="/calculators" className="hover:text-forest-900">
            Calculators
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-forest-800">Mileage log</span>
        </nav>

        <div className="mt-4 text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
          Free tool · {TAX_YEAR}
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight max-w-3xl">
          IRS Mileage Log
        </h1>
        <p className="mt-4 text-base sm:text-lg text-ink-soft max-w-2xl leading-relaxed">
          Enter your business trips and get a log with the date, purpose and
          miles Publication 463 expects, priced at the {TAX_YEAR} standard
          rate. Download it as CSV. Nothing is uploaded, and nothing is
          filled in for you.
        </p>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
        <MileageLogBuilder />
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8 grid gap-8">
        <div>
          <h2 className="display text-2xl text-forest-900">
            What the IRS actually asks for
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            Three things per trip: the{" "}
            <strong className="text-forest-800">date</strong>, the{" "}
            <strong className="text-forest-800">business purpose</strong>, and
            the <strong className="text-forest-800">miles</strong>. There is no
            required format, no official form, and no need to file the log with
            your return. What matters is that it exists, that it is accurate,
            and that it was made at or near the time of the trip.
          </p>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            That last word is the one that decides cases.{" "}
            <strong className="text-forest-800">Contemporaneous</strong> means
            written down when it happened. A year-end reconstruction from a
            calendar and a fuel card is the substantiation most likely to be
            challenged, and it is also the most common. {RATE_SENTENCE}
          </p>
        </div>

        <div>
          <h2 className="display text-2xl text-forest-900">
            Where logs are usually weak
          </h2>
          <ul className="mt-3 grid gap-2.5 text-sm sm:text-base text-ink-soft leading-relaxed">
            <li>
              <strong className="text-forest-800">Purpose says nothing.</strong>{" "}
              &ldquo;Work&rdquo; or &ldquo;errands&rdquo; restates that the trip
              was for business without identifying it. Name the client, the
              site, or the task.
            </li>
            <li>
              <strong className="text-forest-800">Commuting is included.</strong>{" "}
              Home to a regular workplace is personal, however early you leave.
              Between worksites, to a client, or to a temporary location during
              the day does count.
            </li>
            <li>
              <strong className="text-forest-800">
                Round numbers everywhere.
              </strong>{" "}
              A log where every trip is exactly 20 miles reads as an estimate,
              because it is one.
            </li>
            <li>
              <strong className="text-forest-800">
                One rate for the whole year.
              </strong>{" "}
              In a split-rate year the rate depends on when you drove. This tool
              applies each trip&rsquo;s own date.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="display text-2xl text-forest-900">Common questions</h2>
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

        <p className="text-sm text-ink-soft leading-relaxed">
          Working out what the miles are worth instead?{" "}
          <Link
            href="/calculators/mileage-deduction"
            className="text-gold-700 underline underline-offset-2 hover:text-forest-900"
          >
            Mileage deduction calculator
          </Link>
          . Reimbursing staff rather than claiming your own?{" "}
          <Link
            href="/calculators/mileage-reimbursement"
            className="text-gold-700 underline underline-offset-2 hover:text-forest-900"
          >
            Employee mileage reimbursement calculator
          </Link>
          . The longer explanation lives in{" "}
          <Link
            href="/guides/business-mileage-deduction"
            className="text-gold-700 underline underline-offset-2 hover:text-forest-900"
          >
            the mileage deduction guide
          </Link>
          .
        </p>

        <p className="text-xs text-ink-muted leading-relaxed">
          This tool is for organising your own records and is not tax advice.
          It formats and totals what you enter; it does not verify that a trip
          was deductible. See IRS Publication 463 for the substantiation rules,
          and confirm your situation with a licensed CPA.
        </p>
      </section>
    </main>
  );
}
