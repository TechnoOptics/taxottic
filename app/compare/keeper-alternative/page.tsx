import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";

const SITE = "https://taxottic.com";
const SLUG = "keeper-alternative";
const TITLE = "Keeper Tax Alternative (2026), Taxottic";
const DESCRIPTION =
  "Looking for a Keeper alternative? Taxottic is a year-round tax-forecasting companion for freelancers, live estimates, quarterly taxes, 1,000+ IRS-cited deductions, and automatic mileage, free to start.";

export const metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: `/compare/${SLUG}` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `/compare/${SLUG}`,
    type: "website",
  },
  keywords: [
    "keeper tax alternative",
    "keeper alternative",
    "keeper tax app alternative",
    "freelancer deduction tracker alternative",
    "self-employed tax app",
  ],
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-snippet": -1,
      "max-image-preview": "large",
    },
  },
};

const BREADCRUMB_LD = {
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "Compare", item: `${SITE}/compare` },
    {
      "@type": "ListItem",
      position: 3,
      name: "Keeper alternative",
      item: `${SITE}/compare/${SLUG}`,
    },
  ],
};

const FAQ_LD = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: [
    {
      "@type": "Question",
      name: "How is Taxottic different from Keeper?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Both connect to your bank, find deductible expenses, and show a running estimate of what you owe. The difference is scope and focus: Keeper also files your return and offers human tax pros, and its plans run around $20/month and up. Taxottic doesn't file, it's a year-round forecasting companion with a 1,000+ IRS-cited deduction library, full federal + state + self-employment + quarterly forecasting, and automatic mileage tracking, starting free.",
      },
    },
    {
      "@type": "Question",
      name: "Does Taxottic file my taxes like Keeper?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "No. Keeper can file your federal and state return; Taxottic does not file. Taxottic is built to keep your forecast accurate and your deductions organized all year, then pairs with whatever you file with. If in-app filing is essential to you, Keeper covers that; if you want a cheaper, forecasting-first companion, that's Taxottic.",
      },
    },
    {
      "@type": "Question",
      name: "Is Taxottic cheaper than Keeper?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Taxottic has a free tier with no card and paid plans from $4.99/month. Keeper's deduction-tracking plan is around $20/month, with filing bundles priced higher, as of early 2026. Because Taxottic doesn't bundle filing, it's lighter and cheaper for people who just want the year-round tax picture. Check each provider's site for current pricing.",
      },
    },
  ],
};

const VERIFIED = "Verified February 2026 against Keeper's own site.";

export default function KeeperAlternativePage() {
  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <JsonLd data={BREADCRUMB_LD} />
      <JsonLd data={FAQ_LD} />

      <header
        className="relative"
        style={{
          background:
            "linear-gradient(180deg, #2a3a5e 0%, #1d2843 60%, #121a2a 100%)",
          paddingTop:
            "max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px))",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <Wordmark size="md" tone="cream" />
          <SignInIconLink />
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-2">
        <nav
          aria-label="Breadcrumb"
          className="text-xs text-ink-muted flex items-center gap-1.5"
        >
          <Link href="/" className="hover:text-forest-900">
            Home
          </Link>
          <span aria-hidden="true">/</span>
          <Link href="/compare" className="hover:text-forest-900">
            Compare
          </Link>
          <span aria-hidden="true">/</span>
          <span className="text-forest-800">Keeper</span>
        </nav>
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700 mt-6">
          Compare
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight">
          A Keeper alternative, focused on the forecast.
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
          Keeper and Taxottic overlap a lot, both connect to your bank, find
          deductions, and estimate what you owe. Here&rsquo;s an honest look at
          where they part ways, so you can pick the one that matches how you
          actually want to handle your taxes.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8 grid gap-8">
        <div className="card p-6">
          <h2 className="display text-xl text-forest-900">
            The honest version first
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            Keeper is a strong, AI-driven deduction tracker that also{" "}
            <strong className="text-forest-800">files your return</strong> and
            gives you access to human tax pros, a lot of value if you want one
            app to do everything, at a price that reflects it. Taxottic is
            deliberately narrower: it&rsquo;s a{" "}
            <strong className="text-forest-800">
              year-round tax-forecasting companion
            </strong>{" "}
            that <strong className="text-forest-800">doesn&rsquo;t file</strong>.
            It focuses everything on keeping your forecast accurate and your
            deductions organized and cited, then pairs with whatever you file
            with, for less.
          </p>
        </div>

        <div>
          <h2 className="display text-2xl text-forest-900">
            Where Taxottic leans in
          </h2>
          <ul className="mt-4 grid gap-3">
            {[
              [
                "IRS-cited deductions, not just flagged transactions",
                "A library of 1,000+ deductions, each tied to its IRS source and filtered to your entity type, so a deduction comes with the citation that backs it up.",
              ],
              [
                "A full forecasting engine",
                "Live federal + state income tax, self-employment tax, the QBI deduction, the extra Medicare surcharge, and a quarterly payment schedule, the same math the app runs is the one behind our free calculators.",
              ],
              [
                "Mileage that logs itself",
                "Automatic background GPS mileage tracking builds an IRS-ready drive log without you thinking about it.",
              ],
              [
                "Built for teams and multiple businesses",
                "Run several companies, add employees, or work as a firm across many clients, not just a single-person view.",
              ],
              [
                "Free to start, then from $4.99/mo",
                "A free tier with no card, and paid plans that come in under Keeper's ~$20/month deduction plan, because you're not paying for bundled filing you may not need.",
              ],
            ].map(([h, b]) => (
              <li key={h} className="card p-5">
                <h3 className="text-base font-medium text-forest-900">{h}</h3>
                <p className="mt-1.5 text-sm text-ink-soft leading-relaxed">
                  {b}
                </p>
              </li>
            ))}
          </ul>
        </div>

        <div className="card p-6">
          <h2 className="display text-xl text-forest-900">
            When Keeper is the better fit
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            If you want a single app that both tracks deductions and{" "}
            <strong className="text-forest-800">files your return</strong>, or
            you value having a human tax pro to message, Keeper is built for
            exactly that and does it well. Taxottic won&rsquo;t file for you.
            It&rsquo;s the right pick when you&rsquo;ve got filing covered and
            want a sharper, cheaper, always-current forecast plus a
            citation-backed deduction library the rest of the year.
          </p>
          <p className="mt-3 text-[11px] text-ink-muted">{VERIFIED}</p>
        </div>

        <div>
          <h2 className="display text-2xl text-forest-900">Frequently asked</h2>
          <div className="mt-4 grid gap-4">
            {FAQ_LD.mainEntity.map((qa) => (
              <div key={qa.name} className="card p-5">
                <h3 className="text-base font-medium text-forest-900">
                  {qa.name}
                </h3>
                <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                  {qa.acceptedAnswer.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-forest-900 text-cream p-7 text-center">
          <h2 className="display text-2xl text-gold-300">
            See your number in 60 seconds
          </h2>
          <p className="mt-2 text-sm text-cream/90 max-w-md mx-auto leading-relaxed">
            Try a free calculator, or start a free account and connect your bank
            for a live forecast, no card required.
          </p>
          <div className="mt-4 flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/login?intent=signup"
              className="rounded-full bg-gold-400 px-5 py-2.5 text-sm font-semibold text-forest-950 hover:bg-gold-300 transition-colors"
            >
              Start free →
            </Link>
            <Link
              href="/calculators/self-employment-tax"
              className="rounded-full border border-cream/30 px-5 py-2.5 text-sm font-medium text-cream hover:bg-cream/10 transition-colors"
            >
              Try a calculator
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
