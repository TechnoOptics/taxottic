import { JsonLd } from "@/components/seo/JsonLd";
import { GuideShell, H2, P, UL, LI, Callout } from "@/components/guides/GuideShell";

const SITE = "https://taxottic.com";
const SLUG = "business-mileage-deduction";
const TITLE = "Business mileage deduction: how to track and claim it";
const DESCRIPTION =
  "How the business mileage deduction works: the standard mileage rate vs actual vehicle expenses, which drives count, and the mileage log the IRS expects you to keep.";

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
    { "@type": "ListItem", position: 3, name: "Business mileage deduction", item: `${SITE}/guides/${SLUG}` },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "How does the business mileage deduction work?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "You deduct the cost of driving your own vehicle for business in one of two ways. The standard mileage rate multiplies your business miles by a set per-mile rate the IRS publishes each year. The actual-expense method deducts the business-use percentage of your real vehicle costs — gas, insurance, repairs, depreciation. You pick one method per vehicle per year; either way you need a mileage log. See IRS Publication 463.",
      },
    },
    {
      "@type": "Question",
      name: "What driving counts as business mileage?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Driving between work locations, to client or customer meetings, to pick up supplies, to the bank for business, or to a temporary work site. Your regular commute from home to a fixed workplace is personal and not deductible — but if your home is your principal place of business, trips from there to other work locations can count. Keep personal and business miles separate.",
      },
    },
    {
      "@type": "Question",
      name: "What kind of mileage log does the IRS require?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A contemporaneous record: for each business trip, the date, destination or purpose, and miles driven, plus your total annual mileage. 'Contemporaneous' means kept at the time, not reconstructed from memory at tax time. A GPS-based app that logs trips automatically satisfies this and is far more defensible than a guess.",
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
        kicker="Mileage"
        title={TITLE}
        lead="If you drive for work, those miles are money. Here's how the deduction works, which trips qualify, and the log you need to keep to claim it cleanly."
        updated="June 2026"
      >
        <H2>Two ways to claim it</H2>
        <UL>
          <LI>
            <strong>Standard mileage rate</strong> — multiply your business
            miles by the per-mile rate the IRS sets each year. Simple, and it
            already bundles in gas, wear, and depreciation. Best for most
            people and most cars.
          </LI>
          <LI>
            <strong>Actual expenses</strong> — add up gas, insurance, repairs,
            lease or depreciation, then deduct the business-use percentage.
            Worth the extra tracking for expensive vehicles or heavy business
            use.
          </LI>
        </UL>
        <P>
          You choose one method per vehicle per year (with some rules about
          switching once you&apos;ve used actual expenses). The standard rate
          wins on simplicity for most freelancers.
        </P>

        <H2>Which trips count</H2>
        <UL>
          <LI>Driving to a client, customer, or job site</LI>
          <LI>Trips between two work locations</LI>
          <LI>Picking up supplies or equipment, or a business bank run</LI>
          <LI>Travel to a temporary work location</LI>
        </UL>
        <P>
          Your daily <strong>commute</strong> to a regular workplace is
          personal — not deductible. But if your home qualifies as your
          principal place of business, driving from there to other work stops
          generally does count.
        </P>

        <H2>The log is the whole game</H2>
        <P>
          The deduction lives or dies on records. The IRS wants a{" "}
          <strong>contemporaneous mileage log</strong>: date, destination or
          purpose, and miles for each business trip, plus your total miles for
          the year. Reconstructing it in April from memory is exactly what gets
          disallowed in an audit.
        </P>
        <Callout>
          This is the friction Taxottic&apos;s mileage tracker removes: it logs
          your drives automatically by GPS, you swipe each one business or
          personal, and the business miles flow straight into your deduction at
          the current IRS rate — a clean, contemporaneous log without the
          notebook.
        </Callout>

        <H2>Frequently asked</H2>
        <H3FAQ q="How does the business mileage deduction work?">
          You deduct the cost of driving your own vehicle for business in one
          of two ways. The <strong>standard mileage rate</strong> multiplies
          your business miles by a set per-mile rate the IRS publishes each
          year. The <strong>actual-expense method</strong> deducts the
          business-use percentage of your real vehicle costs — gas, insurance,
          repairs, depreciation. You pick one method per vehicle per year;
          either way you need a mileage log. See IRS Publication 463.
        </H3FAQ>
        <H3FAQ q="What driving counts as business mileage?">
          Driving between work locations, to client or customer meetings, to
          pick up supplies, to the bank for business, or to a temporary work
          site. Your regular commute from home to a fixed workplace is personal
          and not deductible — but if your home is your principal place of
          business, trips from there to other work locations can count. Keep
          personal and business miles separate.
        </H3FAQ>
        <H3FAQ q="What kind of mileage log does the IRS require?">
          A <strong>contemporaneous</strong> record: for each business trip, the
          date, destination or purpose, and miles driven, plus your total annual
          mileage. &ldquo;Contemporaneous&rdquo; means kept at the time, not
          reconstructed from memory at tax time. A GPS-based app that logs trips
          automatically satisfies this and is far more defensible than a guess.
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
