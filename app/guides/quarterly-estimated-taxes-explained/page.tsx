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
const SLUG = "quarterly-estimated-taxes-explained";
const TITLE = "Quarterly estimated taxes, explained";
const DESCRIPTION =
  "Who owes quarterly estimated taxes, the four due dates, how to estimate each payment, and how the safe-harbor rule lets you avoid the IRS underpayment penalty.";

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
    { "@type": "ListItem", position: 3, name: "Quarterly estimated taxes explained", item: `${SITE}/guides/${SLUG}` },
  ],
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
        text: "Generally, anyone who expects to owe at least $1,000 in tax for the year after subtracting withholding and refundable credits. That covers most freelancers, contractors, and small business owners, because no employer is withholding tax from your income. If you also have a W-2 job, you can increase that paycheck's withholding instead of making separate payments.",
      },
    },
    {
      "@type": "Question",
      name: "When are quarterly estimated taxes due?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "There are four payments a year, normally due around April 15, June 15, September 15, and January 15 of the following year. The periods aren't even three-month quarters, and a due date that lands on a weekend or holiday shifts to the next business day, so confirm each year's exact dates with the IRS.",
      },
    },
    {
      "@type": "Question",
      name: "How do I avoid the underpayment penalty?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Use the safe harbor: pay at least 90% of this year's tax, or 100% of last year's total tax (110% if your prior-year AGI was over $150,000), in timely equal installments. Meet either threshold and the IRS won't charge an underpayment penalty even if you still owe a balance at filing. Pay online with IRS Direct Pay or EFTPS, or mail Form 1040-ES.",
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
        kicker="Estimates"
        title={TITLE}
        lead="No employer is withholding tax from your income, so the IRS asks you to prepay it four times a year. Here's who owes, when, how much, and how to never trip the penalty."
        updated="June 2026"
        calc={{
          href: "/calculators/quarterly-estimated-tax",
          label: "Quarterly estimated tax calculator",
          blurb: "Work out each of your four IRS payments and their due dates.",
        }}
      >
        <H2>Why they exist</H2>
        <P>
          The U.S. tax system is &ldquo;pay as you go.&rdquo; Employees have
          tax withheld from every paycheck automatically. When you&apos;re
          self-employed, nobody does that for you — so you send the IRS
          estimated payments through the year instead of one big check in
          April.
        </P>

        <H2>Who owes them</H2>
        <P>
          As a rule, you owe estimated taxes if you expect to owe at least{" "}
          <strong>$1,000</strong> for the year after withholding and credits.
          That&apos;s most freelancers and small business owners. If you also
          hold a W-2 job, one alternative is to bump up the withholding on
          that paycheck to cover your side income instead.
        </P>

        <H2>The four due dates</H2>
        <P>
          Payments are normally due around these dates (they shift to the
          next business day on weekends and holidays, so confirm each year):
        </P>
        <UL>
          <LI>
            <strong>Q1</strong> — about April 15 (income from Jan–Mar)
          </LI>
          <LI>
            <strong>Q2</strong> — about June 15 (Apr–May)
          </LI>
          <LI>
            <strong>Q3</strong> — about September 15 (Jun–Aug)
          </LI>
          <LI>
            <strong>Q4</strong> — about January 15 of next year (Sep–Dec)
          </LI>
        </UL>
        <P>
          Note the periods aren&apos;t even calendar quarters — Q2 covers two
          months, Q4 covers four. That trips up a lot of people.
        </P>

        <H2>How much to send</H2>
        <P>Two ways to size each payment:</P>
        <UL>
          <LI>
            <strong>Project this year</strong> — estimate your full-year net
            income, figure the income tax plus 15.3% self-employment tax on
            it, subtract any withholding, and split the rest across the
            remaining due dates.
          </LI>
          <LI>
            <strong>Use last year as a floor (safe harbor)</strong> — pay 100%
            of last year&apos;s total tax (110% if your prior-year AGI was over
            $150,000) in equal installments. Simple, and it guarantees no
            penalty.
          </LI>
        </UL>

        <H2>Avoiding the penalty</H2>
        <P>
          The IRS charges an underpayment penalty (really interest) if you
          pay too little, too late. You&apos;re safe if you hit either safe
          harbor above: <strong>90% of this year&apos;s tax</strong> or{" "}
          <strong>100%/110% of last year&apos;s</strong>, paid on time. Pay
          online with IRS Direct Pay or EFTPS, or mail Form 1040-ES.
        </P>

        <Callout>
          The trap isn&apos;t the math — it&apos;s the calendar. Taxottic keeps
          a live forecast of what you owe and reminds you before each due
          date with the amount to send, so you pay the right number on time
          without tracking four irregular deadlines yourself.
        </Callout>

        <H2>Frequently asked</H2>
        <H3FAQ q="Who has to pay quarterly estimated taxes?">
          Generally, anyone who expects to owe at least <strong>$1,000</strong>{" "}
          in tax for the year after subtracting withholding and refundable
          credits. That covers most freelancers, contractors, and small
          business owners, because no employer is withholding tax from your
          income. If you also have a W-2 job, you can increase that
          paycheck&apos;s withholding instead of making separate payments.
        </H3FAQ>
        <H3FAQ q="When are quarterly estimated taxes due?">
          There are four payments a year, normally due around{" "}
          <strong>April 15, June 15, September 15, and January 15</strong> of
          the following year. The periods aren&apos;t even three-month
          quarters, and a due date that lands on a weekend or holiday shifts
          to the next business day, so confirm each year&apos;s exact dates
          with the IRS.
        </H3FAQ>
        <H3FAQ q="How do I avoid the underpayment penalty?">
          Use the <strong>safe harbor</strong>: pay at least 90% of this
          year&apos;s tax, or 100% of last year&apos;s total tax (110% if your
          prior-year AGI was over $150,000), in timely equal installments.
          Meet either threshold and the IRS won&apos;t charge an underpayment
          penalty even if you still owe a balance at filing. Pay online with
          IRS Direct Pay or EFTPS, or mail Form 1040-ES.
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
