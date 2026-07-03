import { JsonLd } from "@/components/seo/JsonLd";
import { GuideShell, H2, P, UL, LI, Callout } from "@/components/guides/GuideShell";

const SITE = "https://taxottic.com";
const SLUG = "1099-vs-w2";
const TITLE = "1099 vs W-2: how each affects your taxes";
const DESCRIPTION =
  "The real tax difference between 1099 contractor and W-2 employee income: who withholds, who pays self-employment tax, who can deduct expenses, and who owes quarterly estimates.";

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
    { "@type": "ListItem", position: 3, name: "1099 vs W-2", item: `${SITE}/guides/${SLUG}` },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What's the difference between a 1099 and a W-2?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A W-2 reports wages from an employer who withholds income tax and pays half of your Social Security and Medicare taxes. A 1099-NEC reports payments to an independent contractor, where nothing is withheld — you're responsible for your own income tax, both halves of Social Security and Medicare (self-employment tax), and quarterly estimated payments. In short: W-2 = employee with taxes handled for you; 1099 = self-employed, handling taxes yourself.",
      },
    },
    {
      "@type": "Question",
      name: "Do I pay more tax as a 1099 contractor?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "On the same gross pay, often yes at first glance, because you pay the full 15.3% self-employment tax instead of the employee's withheld half. But contractors can deduct business expenses, claim the Qualified Business Income deduction, deduct half of their self-employment tax, and contribute to a SEP-IRA or Solo 401(k) — which can offset much of the difference. The right comparison is after-deduction, not gross.",
      },
    },
    {
      "@type": "Question",
      name: "Do 1099 contractors pay quarterly taxes?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Usually. If you expect to owe $1,000 or more for the year after withholding and credits, the IRS expects four estimated payments (around April, June, September, and January). No employer is withholding for you, so estimates are how you stay current and avoid the underpayment penalty.",
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
        kicker="1099 vs W-2"
        title={TITLE}
        lead="The forms look similar, but they put you on two very different tax footings. Here's what actually changes when income comes on a 1099 instead of a W-2."
        updated="June 2026"
        calc={{
          href: "/calculators/effective-tax-rate",
          label: "Effective tax rate calculator",
          blurb: "See your real rate and take-home on 1099 vs W-2 income.",
        }}
      >
        <H2>What each form means</H2>
        <UL>
          <LI>
            <strong>W-2 (employee)</strong> — your employer withholds federal
            (and usually state) income tax from each paycheck and pays half of
            your Social Security and Medicare. At tax time, most of your
            liability is already covered.
          </LI>
          <LI>
            <strong>1099-NEC (independent contractor)</strong> — the payer
            sends you the full amount with nothing withheld. You report it on
            Schedule C and owe income tax plus the full self-employment tax
            yourself.
          </LI>
        </UL>

        <H2>The big tax differences</H2>
        <UL>
          <LI>
            <strong>Self-employment tax</strong> — a W-2 employee pays 7.65%
            FICA (the employer pays the other half). A 1099 contractor pays the
            full <strong>15.3%</strong> as self-employment tax (you do get to
            deduct half of it against income tax).
          </LI>
          <LI>
            <strong>Withholding vs estimates</strong> — W-2 taxes are withheld
            automatically; 1099 income usually requires{" "}
            <strong>quarterly estimated payments</strong> so you don&apos;t owe
            a penalty.
          </LI>
          <LI>
            <strong>Deductions</strong> — this is where contractors win back
            ground. You can deduct business expenses, claim the{" "}
            <strong>QBI deduction</strong> (up to 20% of qualified business
            income), and shelter income in a SEP-IRA or Solo 401(k). Employees
            have far fewer options.
          </LI>
        </UL>

        <Callout>
          A useful reflex: when 1099 money lands, it&apos;s not all yours — a
          slice belongs to the IRS because no one withheld it. Set aside
          25–30% the moment you&apos;re paid, and the year-end bill is a
          non-event.
        </Callout>

        <H2>If you have both</H2>
        <P>
          Plenty of people hold a W-2 job and freelance on the side. Your W-2
          withholding helps cover the side income too — and you can bump up
          that withholding (via Form W-4) instead of making separate estimated
          payments. A combined forecast keeps the two from surprising you at
          filing.
        </P>

        <H2>Frequently asked</H2>
        <H3FAQ q="What's the difference between a 1099 and a W-2?">
          A W-2 reports wages from an employer who withholds income tax and
          pays half of your Social Security and Medicare taxes. A 1099-NEC
          reports payments to an independent contractor, where nothing is
          withheld — you&apos;re responsible for your own income tax, both
          halves of Social Security and Medicare (self-employment tax), and
          quarterly estimated payments. In short: W-2 = employee with taxes
          handled for you; 1099 = self-employed, handling taxes yourself.
        </H3FAQ>
        <H3FAQ q="Do I pay more tax as a 1099 contractor?">
          On the same gross pay, often yes at first glance, because you pay the
          full 15.3% self-employment tax instead of the employee&apos;s
          withheld half. But contractors can deduct business expenses, claim
          the Qualified Business Income deduction, deduct half of their
          self-employment tax, and contribute to a SEP-IRA or Solo 401(k) —
          which can offset much of the difference. The right comparison is
          after-deduction, not gross.
        </H3FAQ>
        <H3FAQ q="Do 1099 contractors pay quarterly taxes?">
          Usually. If you expect to owe $1,000 or more for the year after
          withholding and credits, the IRS expects four estimated payments
          (around April, June, September, and January). No employer is
          withholding for you, so estimates are how you stay current and avoid
          the underpayment penalty.
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
