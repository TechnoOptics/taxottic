import { JsonLd } from "@/components/seo/JsonLd";
import { GuideShell, H2, P, UL, LI, Callout } from "@/components/guides/GuideShell";

const SITE = "https://taxottic.com";
const SLUG = "first-year-freelancer-tax-checklist";
const TITLE = "Your first year freelancing: a tax checklist";
const DESCRIPTION =
  "A simple, do-this-now tax checklist for new freelancers and contractors: set aside money, separate your finances, track deductions, and pay quarterly estimates so April never surprises you.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `/guides/${SLUG}`, type: "article" },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large" } },
};

const ARTICLE_LD = {
  "@context": "https://schema.org",
  "@type": "Article",
  headline: TITLE,
  description: DESCRIPTION,
  mainEntityOfPage: `${SITE}/guides/${SLUG}`,
  author: { "@type": "Organization", name: "Taxottic", url: SITE },
  publisher: { "@id": `${SITE}/#organization` },
  inLanguage: "en-US",
};

const BREADCRUMB_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE}/guides` },
    { "@type": "ListItem", position: 3, name: "First-year freelancer tax checklist", item: `${SITE}/guides/${SLUG}` },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What taxes do freelancers pay?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Two: federal (and usually state) income tax on your profit, and self-employment tax of 15.3% that covers Social Security and Medicare. Because no employer withholds for you, you pay both through quarterly estimated payments during the year and reconcile on your annual return (Schedule C plus Schedule SE).",
      },
    },
    {
      "@type": "Question",
      name: "When do I start paying quarterly taxes as a new freelancer?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "As soon as you expect to owe $1,000 or more for the year after any withholding and credits. Estimated payments are due roughly April 15, June 15, September 15, and January 15 of the next year. Pay starting with the quarter in which you begin earning; you don't wait until next April.",
      },
    },
    {
      "@type": "Question",
      name: "What records should a freelancer keep?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Every invoice and payment received, every business expense with its receipt, a mileage log for business driving, and your home office square footage. A separate business bank account makes this almost automatic. Keep records for at least three years; the cleaner they are, the more deductions you can defend.",
      },
    },
  ],
};

export default function Page() {
  return (
    <>
      <JsonLd data={ARTICLE_LD} />
      <JsonLd data={BREADCRUMB_LD} />
      <JsonLd data={FAQ_LD} />
      <GuideShell
        kicker="First year"
        title={TITLE}
        lead="Going out on your own? Do these few things from day one and your first tax season will be boring — in the best way."
        updated="June 2026"
      >
        <H2>The day-one checklist</H2>
        <UL>
          <LI>
            <strong>Open a separate business bank account.</strong> One account
            for business income and expenses makes bookkeeping, deductions, and
            an audit defense almost effortless.
          </LI>
          <LI>
            <strong>Set aside 25–30% of every payment.</strong> Move it to a
            dedicated tax savings account the moment a client pays. Treat it as
            already spent.
          </LI>
          <LI>
            <strong>Track income and expenses from the first dollar.</strong>{" "}
            You can&apos;t deduct what you didn&apos;t record. Capture receipts
            as you go, not in April.
          </LI>
          <LI>
            <strong>Learn your deductions.</strong> Home office, mileage,
            software, phone, supplies, and more all lower your taxable income —
            see our{" "}
            <a href="/guides/schedule-c-deductions" className="text-gold-800 underline">
              Schedule C deductions guide
            </a>
            .
          </LI>
          <LI>
            <strong>Plan for quarterly estimated taxes.</strong> Four payments
            a year keep you current and penalty-free — see our{" "}
            <a href="/guides/quarterly-estimated-taxes-explained" className="text-gold-800 underline">
              quarterly taxes guide
            </a>
            .
          </LI>
        </UL>

        <H2>Set up once, benefit all year</H2>
        <UL>
          <LI>
            <strong>Consider an EIN.</strong> A free federal Employer
            Identification Number lets you give clients a business ID instead of
            your SSN. (You can stay a sole proprietor; no entity change needed.)
          </LI>
          <LI>
            <strong>Open a retirement account.</strong> A SEP-IRA or Solo 401(k)
            lets you deduct contributions and shelter profit — one of the
            biggest tax savers available to the self-employed.
          </LI>
          <LI>
            <strong>Deduct your health insurance.</strong> If you buy your own
            and aren&apos;t eligible for an employer plan, premiums are usually
            deductible as an adjustment to income.
          </LI>
        </UL>

        <Callout>
          The whole checklist comes down to one habit: separate the money and
          set aside the tax portion the instant you&apos;re paid. Everything
          else is bookkeeping. Taxottic does the bookkeeping and the forecast
          for you — connect a bank and it tracks income, flags deductions, and
          tells you what to set aside and when to pay.
        </Callout>

        <H2>At year end</H2>
        <P>
          Your profit and expenses flow onto Schedule C, self-employment tax
          onto Schedule SE, and the totals onto your 1040. If you kept clean
          records all year, this is a quick assembly — and a great moment to
          hand a tidy export to a CPA for anything complex.
        </P>

        <H2>Frequently asked</H2>
        <H3FAQ q="What taxes do freelancers pay?">
          Two: federal (and usually state) income tax on your profit, and
          self-employment tax of 15.3% that covers Social Security and
          Medicare. Because no employer withholds for you, you pay both through
          quarterly estimated payments during the year and reconcile on your
          annual return (Schedule C plus Schedule SE).
        </H3FAQ>
        <H3FAQ q="When do I start paying quarterly taxes as a new freelancer?">
          As soon as you expect to owe $1,000 or more for the year after any
          withholding and credits. Estimated payments are due roughly April 15,
          June 15, September 15, and January 15 of the next year. Pay starting
          with the quarter in which you begin earning; you don&apos;t wait until
          next April.
        </H3FAQ>
        <H3FAQ q="What records should a freelancer keep?">
          Every invoice and payment received, every business expense with its
          receipt, a mileage log for business driving, and your home office
          square footage. A separate business bank account makes this almost
          automatic. Keep records for at least three years; the cleaner they
          are, the more deductions you can defend.
        </H3FAQ>
      </GuideShell>
    </>
  );
}

function H3FAQ({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <h3 className="font-semibold text-forest-900 text-base">{q}</h3>
      <p className="mt-1 text-sm sm:text-base text-ink-soft leading-relaxed">{children}</p>
    </div>
  );
}
