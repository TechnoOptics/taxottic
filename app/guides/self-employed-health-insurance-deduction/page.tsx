import { JsonLd } from "@/components/seo/JsonLd";
import { GuideShell, H2, P, UL, LI, Callout } from "@/components/guides/GuideShell";

const SITE = "https://taxottic.com";
const SLUG = "self-employed-health-insurance-deduction";
const TITLE = "The self-employed health insurance deduction";
const DESCRIPTION =
  "How self-employed people can deduct health, dental, and long-term-care premiums for themselves and their family — who qualifies, what counts, and why it's an adjustment to income, not a Schedule C expense.";

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
    { "@type": "ListItem", position: 3, name: "Self-employed health insurance deduction", item: `${SITE}/guides/${SLUG}` },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Who can take the self-employed health insurance deduction?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Self-employed people with a net profit — sole proprietors, partners, and more-than-2% S-corp shareholders — who paid for their own health coverage. The key disqualifier: you can't take it for any month you were eligible to participate in an employer-subsidized plan through your own job or a spouse's job. If you qualify, you can deduct premiums for yourself, your spouse, and your dependents.",
      },
    },
    {
      "@type": "Question",
      name: "What premiums count?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Medical, dental, and qualifying long-term-care insurance premiums for you and your family. Marketplace (ACA) plans count, though the deduction interacts with any premium tax credit you received. The deduction is limited to your business's net profit — you can't deduct more than the business earned.",
      },
    },
    {
      "@type": "Question",
      name: "Is it a Schedule C expense?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. It's an adjustment to income taken on Schedule 1, not a business expense on Schedule C. That's actually good: it lowers your adjusted gross income directly, and because it's not on Schedule C it doesn't reduce the profit your self-employment tax is based on — but it does reduce your income tax.",
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
        kicker="Health insurance"
        title={TITLE}
        lead="If you buy your own health coverage, you can likely deduct the premiums — for you and your family. Here's who qualifies and how it works."
        updated="June 2026"
        calc={{
          href: "/calculators/self-employment-tax",
          label: "Self-employment tax calculator",
          blurb: "See what you owe on 1099 income after your deductions.",
        }}
      >
        <H2>The basic idea</H2>
        <P>
          When you&apos;re self-employed and pay for your own health insurance,
          the premiums for <strong>you, your spouse, and your dependents</strong>{" "}
          are generally deductible. It covers <strong>medical, dental, and
          qualifying long-term-care</strong> premiums — including Marketplace
          (ACA) plans.
        </P>

        <H2>Who qualifies</H2>
        <UL>
          <LI>
            You have a <strong>net profit</strong> from self-employment (sole
            proprietor, partner, or a more-than-2% S-corp shareholder).
          </LI>
          <LI>
            You paid the premiums yourself.
          </LI>
          <LI>
            <strong>The catch:</strong> you can&apos;t deduct premiums for any
            month you were eligible for an employer-subsidized plan — through
            your own other job, or a spouse&apos;s job. Eligibility disqualifies
            you even if you declined the plan.
          </LI>
        </UL>

        <H2>How much, and where</H2>
        <P>
          The deduction is capped at your business&apos;s{" "}
          <strong>net profit</strong> — you can&apos;t deduct more than you
          earned. And it&apos;s an <strong>adjustment to income</strong> on
          Schedule 1, not a Schedule C expense. That distinction matters:
        </P>
        <UL>
          <LI>It lowers your adjusted gross income (and your income tax).</LI>
          <LI>
            It does <em>not</em> reduce the profit your 15.3% self-employment
            tax is figured on (because it&apos;s off Schedule C).
          </LI>
        </UL>
        <P>
          If you also claimed a premium tax credit for a Marketplace plan, the
          two interact — a circular calculation worth letting software or a CPA
          handle.
        </P>

        <Callout>
          This is one of the most-missed deductions for the newly self-employed,
          precisely because it isn&apos;t on Schedule C. Taxottic tracks it as
          an income adjustment in your forecast so it&apos;s counted, not
          forgotten.
        </Callout>

        <H2>Frequently asked</H2>
        <H3FAQ q="Who can take the self-employed health insurance deduction?">
          Self-employed people with a net profit — sole proprietors, partners,
          and more-than-2% S-corp shareholders — who paid for their own health
          coverage. The key disqualifier: you can&apos;t take it for any month
          you were eligible to participate in an employer-subsidized plan
          through your own job or a spouse&apos;s job. If you qualify, you can
          deduct premiums for yourself, your spouse, and your dependents.
        </H3FAQ>
        <H3FAQ q="What premiums count?">
          Medical, dental, and qualifying long-term-care insurance premiums for
          you and your family. Marketplace (ACA) plans count, though the
          deduction interacts with any premium tax credit you received. The
          deduction is limited to your business&apos;s net profit — you
          can&apos;t deduct more than the business earned.
        </H3FAQ>
        <H3FAQ q="Is it a Schedule C expense?">
          No. It&apos;s an <strong>adjustment to income</strong> taken on
          Schedule 1, not a business expense on Schedule C. That&apos;s actually
          good: it lowers your adjusted gross income directly, and because
          it&apos;s not on Schedule C it doesn&apos;t reduce the profit your
          self-employment tax is based on — but it does reduce your income tax.
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
