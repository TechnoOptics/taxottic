import { JsonLd } from "@/components/seo/JsonLd";
import { GuideShell, H2, P, UL, LI, Callout } from "@/components/guides/GuideShell";

const SITE = "https://taxottic.com";
const SLUG = "sole-proprietor-vs-llc-vs-s-corp-taxes";
const TITLE = "Sole proprietor, LLC, or S-corp: how each is taxed";
const DESCRIPTION =
  "How a sole proprietorship, single-member LLC, and S-corp election differ for taxes — pass-through income, self-employment tax, and when an S-corp salary-plus-distributions setup can save money.";

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
    { "@type": "ListItem", position: 3, name: "Sole proprietor vs LLC vs S-corp taxes", item: `${SITE}/guides/${SLUG}` },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "Does forming an LLC change how I'm taxed?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "By default, no. A single-member LLC is a 'disregarded entity' — the IRS taxes it exactly like a sole proprietorship, on Schedule C, with all profit subject to self-employment tax. An LLC gives you legal liability protection and a more formal business identity, but on its own it doesn't lower your taxes. What can change your taxes is electing to have the LLC taxed as an S-corp.",
      },
    },
    {
      "@type": "Question",
      name: "How does an S-corp save on taxes?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "With an S-corp election, you pay yourself a reasonable salary (W-2 wages, subject to Social Security and Medicare) and take remaining profit as distributions, which are not subject to self-employment tax. That can reduce the 15.3% SE tax you'd otherwise pay on all profit. The catch: you must run payroll, pay yourself a defensible 'reasonable' salary, and file a separate corporate return (Form 1120-S) — added cost and complexity that only pays off above a certain profit level.",
      },
    },
    {
      "@type": "Question",
      name: "When should I consider an S-corp?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Usually once your net profit is consistently high enough that the self-employment-tax savings exceed the cost of payroll, bookkeeping, and a separate tax return — often discussed around the $40,000–$80,000+ profit range, but it depends entirely on your numbers and state. Because the reasonable-salary rules and break-even math are situation-specific, this is the decision most worth running past a CPA before you elect.",
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
        kicker="Entity & tax"
        title={TITLE}
        lead="Sole proprietor, LLC, and S-corp aren't three flavors of the same thing — they're a mix of legal structure and tax treatment. Here's how each actually affects what you owe."
        updated="June 2026"
      >
        <H2>Sole proprietorship</H2>
        <P>
          The default when you start working for yourself — no paperwork
          required. Your business profit flows onto{" "}
          <strong>Schedule C</strong>, and the full net profit is subject to{" "}
          <strong>self-employment tax</strong> (15.3%) plus income tax. Simple,
          but no liability separation between you and the business.
        </P>

        <H2>Single-member LLC</H2>
        <P>
          An LLC is a <strong>legal</strong> structure, not a tax one. By
          default the IRS treats a single-member LLC as a{" "}
          <strong>disregarded entity</strong> — taxed identically to a sole
          proprietorship (Schedule C, full self-employment tax). What you gain
          is <strong>liability protection</strong> and a cleaner business
          identity; what you don&apos;t gain, by itself, is a lower tax bill.
        </P>

        <H2>S-corp election</H2>
        <P>
          An S-corp isn&apos;t a separate kind of company — it&apos;s a{" "}
          <strong>tax election</strong> a corporation or LLC can make. Here the
          math changes:
        </P>
        <UL>
          <LI>
            You pay yourself a <strong>reasonable salary</strong> as W-2 wages
            — that part is subject to Social Security and Medicare.
          </LI>
          <LI>
            Remaining profit comes out as <strong>distributions</strong>, which
            are <em>not</em> subject to self-employment tax.
          </LI>
          <LI>
            That split can cut the 15.3% you&apos;d otherwise pay on all
            profit — the core S-corp tax benefit.
          </LI>
        </UL>
        <P>The trade-offs are real:</P>
        <UL>
          <LI>You must run actual payroll and withhold on your salary.</LI>
          <LI>
            The salary has to be <strong>&ldquo;reasonable&rdquo;</strong> for
            your role — the IRS scrutinizes artificially low salaries used to
            dodge payroll tax.
          </LI>
          <LI>
            You file a separate return (Form 1120-S) and typically pay for
            payroll and bookkeeping — costs that only pay off above a certain
            profit level.
          </LI>
        </UL>

        <Callout>
          A common path: start as a sole proprietor, form an LLC when you want
          liability protection, and consider the S-corp election once profit is
          consistently high. The S-corp break-even depends entirely on your
          numbers — run it past a CPA before electing.
        </Callout>

        <H2>The common thread</H2>
        <P>
          All three are <strong>pass-through</strong> — the business itself
          doesn&apos;t pay federal income tax; profit passes to your personal
          return. So good forecasting matters regardless of structure: you
          still need to know what you&apos;ll owe and set it aside. Taxottic
          forecasts that for sole proprietors, LLCs, and S-corps alike.
        </P>

        <H2>Frequently asked</H2>
        <H3FAQ q="Does forming an LLC change how I'm taxed?">
          By default, no. A single-member LLC is a{" "}
          <strong>disregarded entity</strong> — the IRS taxes it exactly like a
          sole proprietorship, on Schedule C, with all profit subject to
          self-employment tax. An LLC gives you legal liability protection and a
          more formal business identity, but on its own it doesn&apos;t lower
          your taxes. What can change your taxes is electing to have the LLC
          taxed as an S-corp.
        </H3FAQ>
        <H3FAQ q="How does an S-corp save on taxes?">
          With an S-corp election, you pay yourself a{" "}
          <strong>reasonable salary</strong> (W-2 wages, subject to Social
          Security and Medicare) and take remaining profit as{" "}
          <strong>distributions</strong>, which are not subject to
          self-employment tax. That can reduce the 15.3% SE tax you&apos;d
          otherwise pay on all profit. The catch: you must run payroll, pay
          yourself a defensible &ldquo;reasonable&rdquo; salary, and file a
          separate corporate return (Form 1120-S) — added cost and complexity
          that only pays off above a certain profit level.
        </H3FAQ>
        <H3FAQ q="When should I consider an S-corp?">
          Usually once your net profit is consistently high enough that the
          self-employment-tax savings exceed the cost of payroll, bookkeeping,
          and a separate tax return — often discussed around the
          $40,000–$80,000+ profit range, but it depends entirely on your numbers
          and state. Because the reasonable-salary rules and break-even math are
          situation-specific, this is the decision most worth running past a CPA
          before you elect.
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
