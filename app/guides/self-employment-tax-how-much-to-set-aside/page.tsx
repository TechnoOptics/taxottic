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
const SLUG = "self-employment-tax-how-much-to-set-aside";
const TITLE = "How much should I set aside for taxes when self-employed?";
const DESCRIPTION =
  "A simple way to size your self-employment tax set-aside: self-employment tax (15.3%) plus federal and state income tax. Why 25–30% of net income is a common starting point, and how to do it without thinking.";

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
    { "@type": "ListItem", position: 3, name: "How much to set aside for self-employment tax", item: `${SITE}/guides/${SLUG}` },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "What percentage should I set aside for self-employment taxes?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "A common starting point is 25–30% of your net self-employment income. That has to cover self-employment tax (15.3%) plus federal income tax, and state income tax if your state has one. If you're in a higher bracket or a high-tax state, lean toward the top of that range or above; if you have lots of deductions or a low total income, you may need less. The cleanest habit is to move a fixed percentage of every payment you receive into a separate savings account.",
      },
    },
    {
      "@type": "Question",
      name: "What is the self-employment tax rate?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "15.3% — 12.4% for Social Security plus 2.9% for Medicare. It's charged on 92.35% of your net self-employment earnings. The Social Security portion only applies up to an annual wage base the IRS adjusts each year; above that, only the 2.9% Medicare portion continues (with an extra 0.9% Medicare surtax at higher incomes). You can deduct half of your self-employment tax when figuring your income tax.",
      },
    },
    {
      "@type": "Question",
      name: "Is self-employment tax on top of income tax?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Yes. Self-employment tax (Social Security and Medicare) is separate from and in addition to federal income tax. As an employee these are split with your employer and withheld from your paycheck; when you're self-employed you pay both halves yourself, which is why your total tax can be higher than you'd expect from income-tax brackets alone.",
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
        kicker="Set-aside"
        title={TITLE}
        lead="Short answer: many self-employed people set aside 25–30% of their net income. Here's why, and how to make it automatic so a tax bill never catches you off guard."
        updated="June 2026"
        calc={{
          href: "/calculators/how-much-to-set-aside",
          label: "How much to set aside calculator",
          blurb: "Find the exact percentage of each payment to save for taxes.",
        }}
      >
        <H2>The two taxes you&apos;re saving for</H2>
        <P>
          When you work for yourself, your taxes come in two separate pieces,
          and it&apos;s easy to forget the first one exists:
        </P>
        <UL>
          <LI>
            <strong>Self-employment tax</strong> — Social Security and
            Medicare. It&apos;s a flat <strong>15.3%</strong> (12.4% +
            2.9%) charged on 92.35% of your net business profit. As an
            employee your employer quietly pays half of this; on your own,
            you pay both halves.
          </LI>
          <LI>
            <strong>Income tax</strong> — federal (and state, in most
            states), charged on your taxable income at your bracket. This
            is the one most people remember.
          </LI>
        </UL>
        <P>
          Because the self-employment piece is on top of income tax, the
          all-in rate on your business profit is usually higher than your
          income-tax bracket alone suggests. That gap is exactly what
          surprises first-year freelancers in April.
        </P>

        <H2>A simple rule of thumb</H2>
        <P>
          Set aside <strong>25–30% of your net self-employment income</strong>{" "}
          (what&apos;s left after business expenses). For many sole
          proprietors that comfortably covers both taxes. Adjust from there:
        </P>
        <UL>
          <LI>Higher earners or high-tax states → lean to 30–35%+.</LI>
          <LI>
            Lower total household income, or lots of deductions → you may
            need closer to 20%.
          </LI>
          <LI>
            A working spouse, W-2 withholding, or big credits change the
            picture — a real forecast beats any flat number.
          </LI>
        </UL>
        <Callout>
          The percentage is a safety habit, not a precise bill. The point is
          to never spend money that was never really yours — the tax portion
          was always going to leave.
        </Callout>

        <H2>Two things that lower it</H2>
        <P>Self-employment isn&apos;t all bad news on taxes:</P>
        <UL>
          <LI>
            <strong>Half of your self-employment tax is deductible</strong>{" "}
            against income tax — an above-the-line adjustment you get
            automatically.
          </LI>
          <LI>
            <strong>The Qualified Business Income (QBI) deduction</strong> can
            knock up to 20% off your qualified business income, subject to
            income limits and phase-outs.
          </LI>
        </UL>

        <H2>Make it automatic</H2>
        <P>
          The freelancers who never sweat April aren&apos;t better at math —
          they just removed the decision. The reliable system:
        </P>
        <UL>
          <LI>
            Open a separate savings account just for taxes.
          </LI>
          <LI>
            Every time a client pays you, immediately move your set-aside
            percentage into it. Treat that money as gone.
          </LI>
          <LI>
            Pay your quarterly estimated taxes out of that account on the
            four due dates so the balance never balloons.
          </LI>
        </UL>
        <P>
          This is exactly what Taxottic automates: it watches your income as
          it lands, keeps a running forecast of what you&apos;ll owe (federal
          and state), and tells you the amount to set aside — so the number
          is based on your real situation, not a guess.
        </P>

        <H2>Frequently asked</H2>
        <H3FAQ q="What percentage should I set aside for self-employment taxes?">
          A common starting point is <strong>25–30% of your net
          self-employment income</strong>. That has to cover
          self-employment tax (15.3%) plus federal income tax, and state
          income tax if your state has one. If you&apos;re in a higher
          bracket or a high-tax state, lean toward the top of that range or
          above; if you have lots of deductions or a low total income, you
          may need less. The cleanest habit is to move a fixed percentage of
          every payment you receive into a separate savings account.
        </H3FAQ>
        <H3FAQ q="What is the self-employment tax rate?">
          <strong>15.3%</strong> — 12.4% for Social Security plus 2.9% for
          Medicare. It&apos;s charged on 92.35% of your net self-employment
          earnings. The Social Security portion only applies up to an annual
          wage base the IRS adjusts each year; above that, only the 2.9%
          Medicare portion continues (with an extra 0.9% Medicare surtax at
          higher incomes). You can deduct half of your self-employment tax
          when figuring your income tax.
        </H3FAQ>
        <H3FAQ q="Is self-employment tax on top of income tax?">
          Yes. Self-employment tax (Social Security and Medicare) is separate
          from and in addition to federal income tax. As an employee these
          are split with your employer and withheld from your paycheck; when
          you&apos;re self-employed you pay both halves yourself, which is why
          your total tax can be higher than you&apos;d expect from income-tax
          brackets alone.
        </H3FAQ>
      </GuideShell>
    </>
  );
}

// Visible FAQ entry that mirrors the FAQPage JSON-LD exactly.
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
