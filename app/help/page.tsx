import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export const metadata = {
  title: "Help & FAQ - Taxottic",
  description:
    "Quickstart guides, common questions, and how to get human support.",
  alternates: { canonical: "https://taxottic.com/help" },
  openGraph: {
    title: "Taxottic Help & FAQ",
    description:
      "Quickstart, common questions, and human support — no sign-in required.",
    url: "https://taxottic.com/help",
    type: "website",
  },
  robots: { index: true, follow: true },
};

// Public /help page. The May 2026 audit P2 cluster flagged "no public
// /help, /docs, /support" as a conversion-blocker for a tax product.
// This is the lightweight v1 — quickstart + common questions + how to
// reach a human. Later, /help/<topic> sub-pages can be added as we
// learn what users hit hardest.
//
// Structure: hero, "5-minute quickstart" three-step cards, FAQ by
// category, contact card.

export default function HelpPage() {
  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <header
        className="relative"
        style={{
          background:
            "linear-gradient(180deg, #1a4031 0%, #0f2d24 60%, #0a201a 100%)",
        }}
      >
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="Taxottic home">
            <Wordmark size="md" tone="cream" />
          </Link>
          <Link
            href="/login"
            className="text-sm text-cream/80 hover:text-cream"
          >
            Sign in
          </Link>
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-6 pt-12 sm:pt-16 pb-8">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Help &amp; FAQ
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight">
          We&apos;re here when you need a hand.
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-xl leading-relaxed">
          Most questions have a quick answer below. If yours doesn&apos;t,
          email{" "}
          <a
            href="mailto:contact@taxottic.com"
            className="underline hover:text-forest-900"
          >
            contact@taxottic.com
          </a>{" "}
          and we&apos;ll get back the same business day.
        </p>
      </section>

      <section className="max-w-5xl mx-auto px-6 py-8">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          5-minute quickstart
        </div>
        <h2 className="display mt-2 text-2xl text-forest-900">
          From signup to your first forecast.
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <Step
            n={1}
            title="Sign in"
            body="Google, Microsoft, passkey, or magic link. We don't ask for a credit card to try."
          />
          <Step
            n={2}
            title="Add your first company"
            body="Schedule C, S-corp, or LLC — pick the entity type and we'll set up the right forms. W-2 only? Pick Filer instead."
          />
          <Step
            n={3}
            title="Connect a bank or upload a CSV"
            body="Plaid wires your bank in about 90 seconds. Prefer file uploads? Drag a CSV. Either way the forecast starts updating."
          />
        </div>
      </section>

      <section className="max-w-3xl mx-auto px-6 py-12 sm:py-16 grid gap-10">
        <FaqCategory title="Getting started">
          <Faq q="Is there really no credit card to try?">
            Correct — the Free tier doesn&apos;t take a card. Paid tiers
            offer a 14-day trial that you can cancel before you&apos;re
            charged.
          </Faq>
          <Faq q="W-2 employee — do I need a company?">
            No. Pick &ldquo;Personal forecast&rdquo; on the
            filer-type screen and we&apos;ll skip the company-setup flow
            entirely. You&apos;ll land on the personal forecast at{" "}
            <code className="bg-cream/70 border border-forest-100 rounded px-1 text-[12px]">
              /personal/forecast
            </code>
            .
          </Faq>
          <Faq q="Can I see what the product looks like before signing up?">
            Yes — read-only sample data lives at{" "}
            <Link href="/example" className="underline hover:text-forest-900">
              /example
            </Link>
            . No signup needed.
          </Faq>
        </FaqCategory>

        <FaqCategory title="Bank connections (Plaid)">
          <Faq q="Where do my bank credentials go?">
            Into Plaid&apos;s secure UI; they never reach Taxottic
            servers. We get a token and the transaction stream. See{" "}
            <Link
              href="/legal/security"
              className="underline hover:text-forest-900"
            >
              /legal/security
            </Link>{" "}
            for the full picture.
          </Faq>
          <Faq q="How do I disconnect a bank?">
            Open the company, then <em>Banks &raquo; Disconnect</em>.
            We&apos;ll revoke the Plaid token and stop syncing.
          </Faq>
          <Faq q="My bank isn't in the Plaid list — what now?">
            Use CSV import. Drag any standard transaction export onto
            the upload zone and we&apos;ll categorize it. CSV imports
            are available from the Solo tier and up.
          </Faq>
        </FaqCategory>

        <FaqCategory title="Forecasts &amp; deductions">
          <Faq q="How accurate is the forecast?">
            The engine is verified against 125 unit tests that hit
            IRS-published worked examples, real bracket math for ten
            states, and property-based invariants (refund/owed
            reconciliation, CTC caps, QBI &le; 20% of taxable income,
            etc.). Read the full layer breakdown in{" "}
            <code className="bg-cream/70 border border-forest-100 rounded px-1 text-[12px]">
              docs/forecast-accuracy.md
            </code>
            . That said, Taxottic is not a substitute for advice from a
            licensed CPA or tax attorney.
          </Faq>
          <Faq q="Why does my dashboard show 13% tax-ready on day one?">
            The tax-ready meter measures how many starter deduction
            categories you&apos;ve claimed and how much of your bank
            feed you&apos;ve triaged. A brand-new company hasn&apos;t
            done either yet — log one expense or connect a bank and the
            number starts climbing.
          </Faq>
          <Faq q="Where do the deduction amounts come from?">
            Every deduction we surface cites the IRC section and IRS
            publication. The catalog is 1,025 items today, pulled from
            Pub 334, 463, 535, 587, and 946. If a deduction Bella
            suggests doesn&apos;t feel right, the source URL is one tap
            away.
          </Faq>
        </FaqCategory>

        <FaqCategory title="Billing &amp; plans">
          <Faq q="Where is the pricing?">
            <Link href="/pricing" className="underline hover:text-forest-900">
              /pricing
            </Link>{" "}
            shows every tier including yearly discounts.
          </Faq>
          <Faq q="What happens to my data if I cancel?">
            We keep your data accessible for 30 days after cancellation
            so you can re-subscribe without losing context. After that,
            company data is deleted on a rolling 90-day window. Export
            everything from <em>Billing &raquo; Export</em> before
            cancelling if you want a permanent copy.
          </Faq>
          <Faq q="How do credits and credit roll-over work?">
            Each tier ships with a monthly grant of AI credits (used by
            Bella, receipt OCR, document OCR, and bulk categorize).
            Unused monthly credits roll up to 2× your grant; past that
            they evaporate on the next refresh. Top-up packs you buy
            never expire.
          </Faq>
        </FaqCategory>

        <FaqCategory title="Accounts &amp; security">
          <Faq q="How do I switch between two of my accounts?">
            Profile menu &raquo; <em>Switch accounts</em>. We force the
            Google / Microsoft account picker so you explicitly pick
            which identity to use.
          </Faq>
          <Faq q="I signed in with Google by mistake — same Google account also signed me into Advottic. Is that a session leak?">
            No. See{" "}
            <Link
              href="/legal/security"
              className="underline hover:text-forest-900"
            >
              /legal/security &raquo; Single sign-on across Techno
              Optics products
            </Link>{" "}
            for the explanation. TL;DR: each product has its own
            Supabase project; what re-uses is the Google identity, not
            the session cookie.
          </Faq>
          <Faq q="Where's the changelog?">
            <Link
              href="/changelog"
              className="underline hover:text-forest-900"
            >
              /changelog
            </Link>{" "}
            — public, updated as we ship.
          </Faq>
        </FaqCategory>
      </section>

      <section className="max-w-3xl mx-auto px-6 pb-16">
        <div className="card p-8 grid gap-3">
          <h2 className="display text-xl text-forest-900">
            Still stuck? Email a human.
          </h2>
          <p className="text-sm text-ink-soft leading-relaxed">
            We aim to answer in one business day. For account-suspension
            issues, security reports, or anything time-sensitive, send to
            the per-team address and we&apos;ll route immediately.
          </p>
          <ul className="mt-2 text-sm text-ink-soft grid gap-1">
            <li>
              <strong>General support:</strong>{" "}
              <a
                href="mailto:contact@taxottic.com"
                className="underline hover:text-forest-900"
              >
                contact@taxottic.com
              </a>
            </li>
            <li>
              <strong>Security:</strong>{" "}
              <a
                href="mailto:security@taxottic.com"
                className="underline hover:text-forest-900"
              >
                security@taxottic.com
              </a>
            </li>
            <li>
              <strong>Accessibility:</strong>{" "}
              <a
                href="mailto:access@taxottic.com"
                className="underline hover:text-forest-900"
              >
                access@taxottic.com
              </a>
            </li>
            <li>
              <strong>Privacy / data requests:</strong>{" "}
              <a
                href="mailto:privacy@taxottic.com"
                className="underline hover:text-forest-900"
              >
                privacy@taxottic.com
              </a>
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}

function Step({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <article className="card p-5 grid gap-2">
      <div className="size-7 rounded-full bg-gold-400/20 grid place-items-center text-xs font-semibold text-gold-700">
        {n}
      </div>
      <h3 className="display text-base text-forest-900">{title}</h3>
      <p className="text-sm text-ink-soft leading-relaxed">{body}</p>
    </article>
  );
}

function FaqCategory({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="display text-xl text-forest-900">{title}</h2>
      <div className="mt-4 grid gap-5">{children}</div>
    </div>
  );
}

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-sm font-medium text-forest-900">{q}</div>
      <div className="mt-1 text-sm text-ink-soft leading-relaxed">
        {children}
      </div>
    </div>
  );
}
