import { JsonLd } from "@/components/seo/JsonLd";
import { GuideShell, H2, P, UL, LI, Callout } from "@/components/guides/GuideShell";

const SITE = "https://taxottic.com";
const SLUG = "what-is-a-1099-k";
const TITLE = "What is a 1099-K? Thresholds and what to do with it";
const DESCRIPTION =
  "What a 1099-K reports, why payment apps and marketplaces send one, the changing reporting threshold, and how to reconcile it on your taxes — including personal payments that shouldn't be there.";

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
    { "@type": "ListItem", position: 3, name: "What is a 1099-K", item: `${SITE}/guides/${SLUG}` },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What is a 1099-K?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A 1099-K is an information form that payment networks — card processors and apps like PayPal, Venmo, Stripe, Etsy, and similar — send to report the gross payments they processed for you during the year. It's a copy of what they also report to the IRS. It reflects gross amounts before fees, refunds, or chargebacks, so the number rarely equals your actual taxable income.",
      },
    },
    {
      "@type": "Question",
      name: "What is the 1099-K reporting threshold?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "It's been changing. For years the threshold was over $20,000 and 200 transactions; the IRS has been phasing it down toward $600 in stages, with interim amounts along the way. Because the exact figure depends on the tax year, check the current year's threshold. Important: the threshold only controls whether a form is issued — your income is taxable whether or not you receive a 1099-K.",
      },
    },
    {
      "@type": "Question",
      name: "What if my 1099-K includes personal payments?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "It happens — a friend repaying you or a personal sale can land on a 1099-K if it ran through a business/goods-and-services channel. Don't ignore it, because the IRS has a copy. Report the form's total, then back out the non-taxable amounts following IRS instructions so you're only taxed on real business income. Going forward, keep personal and business payments on separate accounts.",
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
        kicker="1099-K"
        title={TITLE}
        lead="Got a 1099-K from PayPal, Venmo, Stripe, or Etsy and not sure what it means? Here's what it reports, why the number looks too big, and what to do with it."
        updated="June 2026"
      >
        <H2>What it is</H2>
        <P>
          A <strong>1099-K</strong> comes from a payment network — card
          processors and apps like PayPal, Venmo, Stripe, Etsy, and others — and
          reports the <strong>gross</strong> payments they processed for you,
          with a copy going to the IRS. &ldquo;Gross&rdquo; is the key word: it
          doesn&apos;t subtract platform fees, refunds, or chargebacks, so the
          figure is almost always higher than your real income.
        </P>

        <H2>The threshold keeps moving</H2>
        <P>
          The dollar amount that triggers a 1099-K has been in flux. It was long
          set above <strong>$20,000 and 200 transactions</strong>; the IRS has
          been phasing it down toward <strong>$600</strong> in stages, with
          interim figures in between. Check the threshold for the specific tax
          year.
        </P>
        <Callout>
          The threshold only decides <em>whether a form is issued</em> — it has
          nothing to do with whether the money is taxable. Business income is
          taxable whether or not a 1099-K shows up, so report your income from
          your own records regardless.
        </Callout>

        <H2>How to reconcile it</H2>
        <UL>
          <LI>
            Match the 1099-K to your own income records; expect it to be{" "}
            <strong>higher</strong> because it&apos;s gross.
          </LI>
          <LI>
            Deduct the platform fees, refunds, and returns as you normally would
            — your taxable profit is what&apos;s left after legitimate expenses.
          </LI>
          <LI>
            If the form includes <strong>personal payments</strong> (a friend
            repaying you, a personal-item sale), don&apos;t ignore it — report
            the total, then back out the non-taxable amounts per IRS
            instructions.
          </LI>
        </UL>
        <P>
          The cleanest defense is separation: keep business and personal
          payments on different accounts so a 1099-K reflects only business
          activity.
        </P>

        <H2>Frequently asked</H2>
        <H3FAQ q="What is a 1099-K?">
          A 1099-K is an information form that payment networks — card
          processors and apps like PayPal, Venmo, Stripe, Etsy, and similar —
          send to report the gross payments they processed for you during the
          year. It&apos;s a copy of what they also report to the IRS. It
          reflects gross amounts before fees, refunds, or chargebacks, so the
          number rarely equals your actual taxable income.
        </H3FAQ>
        <H3FAQ q="What is the 1099-K reporting threshold?">
          It&apos;s been changing. For years the threshold was over $20,000 and
          200 transactions; the IRS has been phasing it down toward $600 in
          stages, with interim amounts along the way. Because the exact figure
          depends on the tax year, check the current year&apos;s threshold.
          Important: the threshold only controls whether a form is issued — your
          income is taxable whether or not you receive a 1099-K.
        </H3FAQ>
        <H3FAQ q="What if my 1099-K includes personal payments?">
          It happens — a friend repaying you or a personal sale can land on a
          1099-K if it ran through a business/goods-and-services channel.
          Don&apos;t ignore it, because the IRS has a copy. Report the
          form&apos;s total, then back out the non-taxable amounts following IRS
          instructions so you&apos;re only taxed on real business income. Going
          forward, keep personal and business payments on separate accounts.
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
