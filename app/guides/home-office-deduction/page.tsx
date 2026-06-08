import { JsonLd } from "@/components/seo/JsonLd";
import { GuideShell, H2, P, UL, LI, Callout } from "@/components/guides/GuideShell";

const SITE = "https://taxottic.com";
const SLUG = "home-office-deduction";
const TITLE = "Home office deduction: who qualifies and how to calculate it";
const DESCRIPTION =
  "Who can claim the home office deduction, the 'regular and exclusive use' test, and how the simplified ($5/sq ft) and actual-expense methods compare. For self-employed filers.";

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
    { "@type": "ListItem", position: 3, name: "Home office deduction", item: `${SITE}/guides/${SLUG}` },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Who can claim the home office deduction?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Self-employed people who use part of their home regularly and exclusively as their principal place of business — or to meet clients, or as a separate structure used for the business. W-2 employees generally cannot claim it on their federal return through 2025 under current law. The space must be used only for business: a kitchen table you also eat at doesn't qualify.",
      },
    },
    {
      "@type": "Question",
      name: "How do I calculate the home office deduction?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Two methods. The simplified method deducts $5 per square foot of office space up to 300 square feet — a maximum of $1,500, no receipts required. The actual-expense method takes the business-use percentage of your home (office square footage ÷ total square footage) and applies it to rent or mortgage interest, utilities, insurance, repairs, and depreciation. Pick whichever gives the bigger deduction; you can switch year to year. See IRS Publication 587 and Form 8829.",
      },
    },
    {
      "@type": "Question",
      name: "Can I claim a home office if I'm a W-2 employee?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Generally no, not on your federal return. The unreimbursed-employee home office deduction is suspended for employees through 2025 under the Tax Cuts and Jobs Act. If you're self-employed — even as a side gig — you can still claim it for that business. A few states allow an employee version on the state return, so check your state's rules.",
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
        kicker="Home office"
        title={TITLE}
        lead="If you run your business from home, a slice of your rent, utilities, and insurance can become a deduction. Here's who qualifies and the two ways to calculate it."
        updated="June 2026"
      >
        <H2>The two-part qualifying test</H2>
        <P>
          To deduct a home office, the space has to pass both halves of one
          rule — <strong>regular and exclusive use</strong>:
        </P>
        <UL>
          <LI>
            <strong>Regular</strong> — you use it for business on a continuing
            basis, not just now and then.
          </LI>
          <LI>
            <strong>Exclusive</strong> — that area is used <em>only</em> for
            business. A spare room that&apos;s your office passes; the dining
            table you also eat dinner at does not.
          </LI>
        </UL>
        <P>
          It also has to be your <strong>principal place of business</strong> —
          where you do most of your work or your management and admin — or a
          place you regularly meet clients, or a separate structure (like a
          detached studio). A dedicated corner of a room can count if it&apos;s
          used exclusively for work.
        </P>

        <H2>Method 1: simplified</H2>
        <P>
          Deduct <strong>$5 per square foot</strong> of office space, up to
          300 sq ft — so a maximum of <strong>$1,500</strong>. No receipts, no
          depreciation tracking. Best when your office is small or your home
          costs are modest.
        </P>

        <H2>Method 2: actual expenses</H2>
        <P>
          Figure your <strong>business-use percentage</strong> (office sq ft ÷
          total home sq ft), then deduct that share of:
        </P>
        <UL>
          <LI>Rent, or mortgage interest and property tax</LI>
          <LI>Utilities — electricity, gas, water, internet</LI>
          <LI>Homeowners or renters insurance</LI>
          <LI>Repairs and maintenance that benefit the whole home</LI>
          <LI>Depreciation (homeowners)</LI>
        </UL>
        <P>
          More paperwork, but often a bigger deduction if you rent in an
          expensive area or have a large office. File it on Form 8829.
        </P>

        <Callout>
          You can choose whichever method gives the larger deduction each year.
          Taxottic stores your office and total square footage once, then
          computes both methods and applies the better one to your forecast —
          so you don&apos;t leave money on the table.
        </Callout>

        <H2>Frequently asked</H2>
        <H3FAQ q="Who can claim the home office deduction?">
          Self-employed people who use part of their home{" "}
          <strong>regularly and exclusively</strong> as their principal place
          of business — or to meet clients, or as a separate structure used for
          the business. W-2 employees generally cannot claim it on their
          federal return through 2025 under current law. The space must be used
          only for business: a kitchen table you also eat at doesn&apos;t
          qualify.
        </H3FAQ>
        <H3FAQ q="How do I calculate the home office deduction?">
          Two methods. The <strong>simplified method</strong> deducts $5 per
          square foot of office space up to 300 square feet — a maximum of
          $1,500, no receipts required. The <strong>actual-expense method</strong>{" "}
          takes the business-use percentage of your home (office square footage
          ÷ total square footage) and applies it to rent or mortgage interest,
          utilities, insurance, repairs, and depreciation. Pick whichever gives
          the bigger deduction; you can switch year to year. See IRS Publication
          587 and Form 8829.
        </H3FAQ>
        <H3FAQ q="Can I claim a home office if I'm a W-2 employee?">
          Generally no, not on your federal return. The unreimbursed-employee
          home office deduction is suspended for employees through 2025 under
          the Tax Cuts and Jobs Act. If you&apos;re self-employed — even as a
          side gig — you can still claim it for that business. A few states
          allow an employee version on the state return, so check your
          state&apos;s rules.
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
