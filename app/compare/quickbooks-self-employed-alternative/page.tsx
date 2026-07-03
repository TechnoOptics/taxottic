import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";
import { JsonLd } from "@/components/seo/JsonLd";

const SITE = "https://taxottic.com";
const SLUG = "quickbooks-self-employed-alternative";
const TITLE = "QuickBooks Self-Employed Alternative (2026) — Taxottic";
const DESCRIPTION =
  "QuickBooks Self-Employed was discontinued. Taxottic is a year-round tax-forecasting alternative for freelancers — live estimates, quarterly taxes, IRS-cited deductions, and automatic mileage, free to start.";

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
    "quickbooks self-employed alternative",
    "quickbooks solopreneur alternative",
    "quickbooks self employed replacement",
    "self-employed tax software alternative",
    "freelancer tax software",
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
    {
      "@type": "ListItem",
      position: 2,
      name: "Compare",
      item: `${SITE}/compare`,
    },
    {
      "@type": "ListItem",
      position: 3,
      name: "QuickBooks Self-Employed alternative",
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
      name: "What happened to QuickBooks Self-Employed?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Intuit discontinued QuickBooks Self-Employed for new sign-ups in 2024 and now directs people to QuickBooks Solopreneur, its replacement for one-person businesses. Existing subscribers can continue or migrate. If you're looking for an alternative, this is usually why.",
      },
    },
    {
      "@type": "Question",
      name: "Is Taxottic a replacement for QuickBooks Self-Employed?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "For the tax side, yes — Taxottic keeps a live, bank-synced forecast of what you'll owe, tracks quarterly estimated taxes, surfaces IRS-cited deductions, and logs your business mileage automatically. It is not a full bookkeeping suite and it does not file your return, so it pairs with your filing software rather than replacing it. It starts free.",
      },
    },
    {
      "@type": "Question",
      name: "How much does Taxottic cost compared to QuickBooks Solopreneur?",
      acceptedAnswer: {
        "@type": "Answer",
        text: "Taxottic has a free tier with no card required and paid plans starting at $4.99/month (yearly saves about 17%, with a 14-day trial). QuickBooks Solopreneur is priced around $20/month as of early 2026. Check each provider's site for current pricing.",
      },
    },
  ],
};

// Point-in-time competitor facts, kept to verifiable specifics and
// dated so it's clear they're a snapshot, not an evergreen claim.
const VERIFIED = "Verified February 2026 against QuickBooks' own site.";

export default function QuickBooksAlternativePage() {
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
          <Link href="/" aria-label="Taxottic home">
            <Wordmark size="md" tone="cream" />
          </Link>
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
          <span className="text-forest-800">QuickBooks Self-Employed</span>
        </nav>
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700 mt-6">
          Compare
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight">
          A QuickBooks Self-Employed alternative, built around your taxes.
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
          QuickBooks Self-Employed is being retired in favor of QuickBooks
          Solopreneur. If you&rsquo;re weighing what to use instead — and you
          care most about knowing what you&rsquo;ll owe and claiming every
          deduction — here&rsquo;s an honest look at where Taxottic fits.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-8 grid gap-8">
        <div className="card p-6">
          <h2 className="display text-xl text-forest-900">
            The honest version first
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            QuickBooks Solopreneur is a light bookkeeping tool with mileage
            tracking, receipt capture, profit-and-loss reports, and a path to
            file through QuickBooks Live Tax. Taxottic is narrower on purpose:
            it&rsquo;s a{" "}
            <strong className="text-forest-800">
              year-round tax-forecasting companion
            </strong>
            . It doesn&rsquo;t keep a general ledger and{" "}
            <strong className="text-forest-800">
              it doesn&rsquo;t file your return
            </strong>{" "}
            — it pairs with whatever you file with. What it does instead is keep
            a live answer to the question that actually keeps freelancers up at
            night: <em>how much will I owe, and am I setting enough aside?</em>
          </p>
        </div>

        <div>
          <h2 className="display text-2xl text-forest-900">
            Where Taxottic is different
          </h2>
          <ul className="mt-4 grid gap-3">
            {[
              [
                "A live forecast, not a year-end surprise",
                "Connect your bank and Taxottic keeps a running estimate of your federal + state tax, self-employment tax, and QBI deduction — updated as money moves, not reconstructed in April.",
              ],
              [
                "Quarterly estimated taxes, handled",
                "It tells you what to send each quarter and when, so you hit the safe harbor and skip the underpayment penalty.",
              ],
              [
                "IRS-cited deductions",
                "A library of 1,000+ deductions, each tied to its IRS source, filtered to your entity type — so you claim what you're owed with a citation to back it up.",
              ],
              [
                "Mileage that logs itself",
                "Automatic background mileage tracking builds an IRS-ready log as you drive — no notebook, no forgotten trips.",
              ],
              [
                "Free to start, then from $4.99/mo",
                "A free tier with no card, and paid plans well under the ~$20/month range of the one-person bookkeeping tools. Yearly saves ~17%, 14-day trial.",
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
            When QuickBooks Solopreneur is the better fit
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            If you want proper bookkeeping with a profit-and-loss statement,
            invoicing, and an all-in-one path to file your return inside the
            same tool, a bookkeeping suite like QuickBooks Solopreneur or a
            filing product like TurboTax is the right call. Taxottic is for
            people who&rsquo;ve got filing handled and want a sharper, cheaper,
            always-current view of their tax picture the other 51 weeks of the
            year. Plenty of people use both.
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
            for a live forecast — no card required.
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
