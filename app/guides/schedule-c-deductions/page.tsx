import { guideArticleLd } from "@/lib/seo/guide-article";
import { JsonLd } from "@/components/seo/JsonLd";
import {
  GuideShell,
  H2,
  P,
  UL,
  LI,
  Callout,
} from "@/components/guides/GuideShell";

const SITE = "https://taxottic.com";
const SLUG = "schedule-c-deductions";
const TITLE =
  "Schedule C deductions: what self-employed people can write off";
const DESCRIPTION =
  "The everyday business expenses freelancers and sole proprietors can deduct on Schedule C, home office, mileage, software, phone, supplies, retirement, and health insurance, each tied to its IRS source.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/guides/${SLUG}` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `/guides/${SLUG}`, type: "article", images: [{ url: `/api/og/guide?title=${encodeURIComponent(TITLE)}`, width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: [`/api/og/guide?title=${encodeURIComponent(TITLE)}`] },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-snippet": -1, "max-image-preview": "large" },
  },
};

const ARTICLE_LD = guideArticleLd({
  slug: SLUG,
  title: TITLE,
  description: DESCRIPTION,
  published: "2026-06-08",
  modified: "2026-07-04",
});

const BREADCRUMB_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "Guides", item: `${SITE}/guides` },
    { "@type": "ListItem", position: 3, name: "Schedule C deductions", item: `${SITE}/guides/${SLUG}` },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What can I deduct on Schedule C?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Any expense that is ordinary and necessary for your business (IRC §162): home office, business mileage or vehicle costs, phone and internet, software and subscriptions, supplies and equipment, advertising, professional and legal fees, business travel, business meals (generally 50%), and education that maintains or improves your work. Self-employed health insurance and retirement contributions are also deductible, though they're taken as adjustments to income rather than on Schedule C itself.",
      },
    },
    {
      "@type": "Question",
      name: "Can I deduct a home office?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, if you use part of your home regularly and exclusively for business. The simplified method deducts $5 per square foot of office space up to 300 square feet (a $1,500 maximum). The actual-expense method deducts the business-use percentage of rent or mortgage interest, utilities, insurance, and depreciation. See IRS Publication 587.",
      },
    },
    {
      "@type": "Question",
      name: "Can I write off my car for business?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes, for the business-use portion. You can use the standard mileage rate (a set number of cents per business mile, which the IRS updates yearly) or the actual-expense method (the business-use percentage of gas, insurance, repairs, and depreciation), but not both for the same vehicle in the same year. Either way, keep a contemporaneous mileage log. See IRS Publication 463.",
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
        kicker="Deductions"
        title={TITLE}
        lead="Every dollar of legitimate business expense lowers the income you pay tax on. Here are the deductions self-employed people most often miss, and where each one comes from in the tax code."
        updated="June 2026"
        calc={{
          href: "/calculators/self-employment-tax",
          label: "Self-employment tax calculator",
          blurb: "See how Schedule C deductions cut your self-employment tax.",
        }}
      >
        <H2>The one rule behind every deduction</H2>
        <P>
          A business expense is deductible if it&apos;s{" "}
          <strong>ordinary and necessary</strong> for your work, common in
          your field and helpful to your business (that&apos;s IRC §162, the
          foundation of business deductions). Keep a receipt or record, and
          if an expense is part personal, only the business share counts.
        </P>

        <H2>The deductions people miss most</H2>
        <UL>
          <LI>
            <strong>Home office</strong>, regular and exclusive business use
            of part of your home. Simplified method: $5/sq ft up to 300 sq ft.
            Or deduct the business-use % of rent, utilities, and insurance.
            (Pub 587)
          </LI>
          <LI>
            <strong>Vehicle &amp; mileage</strong>, the standard mileage rate
            per business mile, or actual vehicle costs by business-use
            percentage. Keep a log. (Pub 463)
          </LI>
          <LI>
            <strong>Phone &amp; internet</strong>, the business-use portion of
            your monthly bills.
          </LI>
          <LI>
            <strong>Software &amp; subscriptions</strong>, tools you use to do
            the work: design apps, accounting, hosting, domains, stock assets.
          </LI>
          <LI>
            <strong>Supplies &amp; equipment</strong>, from printer paper to a
            laptop. Larger purchases may be expensed immediately under Section
            179 or de minimis safe harbor. (Pub 946)
          </LI>
          <LI>
            <strong>Advertising &amp; marketing</strong>, ads, a website,
            business cards, promotional costs.
          </LI>
          <LI>
            <strong>Professional services</strong>, your accountant, lawyer,
            contractors, and 1099 help.
          </LI>
          <LI>
            <strong>Business travel &amp; meals</strong>, travel away from home
            for work; business meals are generally 50% deductible. (Pub 463)
          </LI>
          <LI>
            <strong>Education</strong>, courses that maintain or improve
            skills for your current business.
          </LI>
        </UL>

        <H2>Two big ones that aren&apos;t on Schedule C</H2>
        <P>
          These are deducted as <strong>adjustments to income</strong> (on
          Schedule 1), not on Schedule C, but they&apos;re among the largest
          tax savers for the self-employed, so don&apos;t miss them:
        </P>
        <UL>
          <LI>
            <strong>Self-employed health insurance</strong>, premiums for you
            and your family, if you aren&apos;t eligible for an employer plan.
          </LI>
          <LI>
            <strong>Retirement contributions</strong>, a SEP-IRA or Solo
            401(k) lets you shelter a substantial share of profit while saving
            for retirement.
          </LI>
        </UL>

        <Callout>
          The hard part isn&apos;t knowing these exist, it&apos;s catching
          them in your bank feed before year-end. Taxottic surfaces 1,025
          IRS-cited deductions and flags likely write-offs as your
          transactions come in, each linked to its IRC section and IRS
          publication.
        </Callout>

        <H2>Frequently asked</H2>
        <H3FAQ q="What can I deduct on Schedule C?">
          Any expense that is <strong>ordinary and necessary</strong> for your
          business (IRC §162): home office, business mileage or vehicle costs,
          phone and internet, software and subscriptions, supplies and
          equipment, advertising, professional and legal fees, business
          travel, business meals (generally 50%), and education that maintains
          or improves your work. Self-employed health insurance and retirement
          contributions are also deductible, though they&apos;re taken as
          adjustments to income rather than on Schedule C itself.
        </H3FAQ>
        <H3FAQ q="Can I deduct a home office?">
          Yes, if you use part of your home <strong>regularly and
          exclusively</strong> for business. The simplified method deducts $5
          per square foot of office space up to 300 square feet (a $1,500
          maximum). The actual-expense method deducts the business-use
          percentage of rent or mortgage interest, utilities, insurance, and
          depreciation. See IRS Publication 587.
        </H3FAQ>
        <H3FAQ q="Can I write off my car for business?">
          Yes, for the business-use portion. You can use the standard mileage
          rate (a set number of cents per business mile, which the IRS updates
          yearly) or the actual-expense method (the business-use percentage of
          gas, insurance, repairs, and depreciation), but not both for the
          same vehicle in the same year. Either way, keep a contemporaneous
          mileage log. See IRS Publication 463.
        </H3FAQ>
      </GuideShell>
    </>
  );
}

function H3FAQ({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <h3 className="font-semibold text-forest-900 text-base">{q}</h3>
      <p className="mt-1 text-sm sm:text-base text-ink-soft leading-relaxed">
        {children}
      </p>
    </div>
  );
}
