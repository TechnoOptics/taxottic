import { JsonLd } from "@/components/seo/JsonLd";
import { GuideShell, H2, P, UL, LI, Callout } from "@/components/guides/GuideShell";

const SITE = "https://taxottic.com";
const SLUG = "qbi-deduction";
const TITLE = "The QBI deduction: a 20% break for small-business income";
const DESCRIPTION =
  "What the Qualified Business Income (QBI) deduction is, who qualifies, how the income limits and the specified-service-business phase-out work, and how it lowers your taxable income.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `/guides/${SLUG}`, type: "article", images: [{ url: `/api/og/guide?title=${encodeURIComponent(TITLE)}`, width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [`/api/og/guide?title=${encodeURIComponent(TITLE)}`] },
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
    { "@type": "ListItem", position: 3, name: "QBI deduction", item: `${SITE}/guides/${SLUG}` },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is the QBI deduction?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "The Qualified Business Income deduction (Section 199A) lets eligible self-employed people and owners of pass-through businesses deduct up to 20% of their qualified business income. It's taken on your personal return after your business expenses, it doesn't reduce self-employment tax, but it lowers the income you pay income tax on. It applies to sole proprietors, partnerships, S-corps, and most LLCs.",
      },
    },
    {
      "@type": "Question",
      name: "Who qualifies for the QBI deduction?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Owners of pass-through businesses with qualified business income. Below an annual taxable-income threshold (which the IRS adjusts each year), most businesses get the full 20% simply. Above the threshold, limits kick in based on W-2 wages your business pays and its property, and 'specified service' businesses (health, law, accounting, consulting, financial services, and similar) get phased out entirely at higher incomes.",
      },
    },
    {
      "@type": "Question",
      name: "Does the QBI deduction reduce self-employment tax?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. QBI reduces your income tax only. Self-employment tax (15.3%) is calculated on your net business profit before QBI, so the deduction doesn't change it. Think of QBI as a discount on the income-tax side of your bill, stacked on top of your ordinary business deductions.",
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
        kicker="QBI"
        title={TITLE}
        lead="One of the biggest breaks for the self-employed: deduct up to 20% of your business income, on top of your normal expenses. Here's how it works and when limits apply."
        updated="June 2026"
        calc={{
          href: "/calculators/self-employment-tax",
          label: "Self-employment tax calculator",
          blurb: "See your QBI deduction and total tax on 1099 income.",
        }}
      >
        <H2>What it is</H2>
        <P>
          The <strong>Qualified Business Income deduction</strong> (Section
          199A) lets most owners of pass-through businesses deduct up to{" "}
          <strong>20% of their qualified business income</strong>. It comes off
          after your regular business expenses and lowers the income you pay{" "}
          <strong>income tax</strong> on. Sole proprietors, partnerships,
          S-corps, and most LLCs can use it.
        </P>

        <H2>The simple case</H2>
        <P>
          If your total taxable income is under an annual threshold the IRS
          updates each year, the math is easy: you generally just deduct 20% of
          your qualified business income (limited to 20% of your taxable income
          minus net capital gains). No wage or property tests, no phase-outs.
          Most freelancers and small operators land here.
        </P>

        <H2>Where it gets complicated</H2>
        <P>Above that income threshold, two things matter:</P>
        <UL>
          <LI>
            <strong>Wage &amp; property limits</strong>, your deduction may be
            capped based on the W-2 wages your business pays and the cost of its
            qualified property.
          </LI>
          <LI>
            <strong>Specified service businesses (SSTBs)</strong>, fields like
            health, law, accounting, consulting, performing arts, and financial
            services get <strong>phased out</strong> of QBI entirely once income
            climbs high enough.
          </LI>
        </UL>
        <P>
          If you&apos;re over the threshold or in an SSTB, this is genuinely
          worth a CPA&apos;s eye, the rules are intricate and the dollars are
          large.
        </P>

        <Callout>
          QBI stacks <em>on top of</em> your ordinary deductions, it
          doesn&apos;t replace them. Taxottic factors the QBI math into your
          forecast automatically, so the deduction is reflected in what it tells
          you to set aside rather than being a year-end surprise.
        </Callout>

        <H2>Frequently asked</H2>
        <H3FAQ q="What is the QBI deduction?">
          The Qualified Business Income deduction (Section 199A) lets eligible
          self-employed people and owners of pass-through businesses deduct up
          to 20% of their qualified business income. It&apos;s taken on your
          personal return after your business expenses, it doesn&apos;t reduce
          self-employment tax, but it lowers the income you pay income tax on.
          It applies to sole proprietors, partnerships, S-corps, and most LLCs.
        </H3FAQ>
        <H3FAQ q="Who qualifies for the QBI deduction?">
          Owners of pass-through businesses with qualified business income.
          Below an annual taxable-income threshold (which the IRS adjusts each
          year), most businesses get the full 20% simply. Above the threshold,
          limits kick in based on W-2 wages your business pays and its property
, and &ldquo;specified service&rdquo; businesses (health, law,
          accounting, consulting, financial services, and similar) get phased
          out entirely at higher incomes.
        </H3FAQ>
        <H3FAQ q="Does the QBI deduction reduce self-employment tax?">
          No. QBI reduces your <strong>income tax</strong> only. Self-employment
          tax (15.3%) is calculated on your net business profit before QBI, so
          the deduction doesn&apos;t change it. Think of QBI as a discount on
          the income-tax side of your bill, stacked on top of your ordinary
          business deductions.
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
