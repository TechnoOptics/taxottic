import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { JsonLd } from "@/components/seo/JsonLd";

// Tier 3 #5: Firm pricing page.
//
// The consumer /pricing page covers Filer / Solo / Studio etc. for
// individual freelancers. Accounting firms need a separate page
// because the pricing dimension is different: per-engagement
// seats, e-signature envelope counts, calendar integrations, and
// the Stripe Connect 3% platform fee on collected invoices.
// Linking from the marketing site to /pricing/firms is also a
// stronger SEO signal than nesting it as a section on /pricing.

export const metadata = {
  title: "Pricing for accounting firms, Starter, Growth, Firm, Enterprise",
  description:
    "Transparent firm-tier pricing for accountants, CPAs, and tax-prep practices. Includes Stripe Connect, e-signature, calendar integrations, and unlimited clients on Enterprise.",
  alternates: { canonical: "/pricing/firms" },
  openGraph: {
    title: "Taxottic for firms, pricing built for accounting practices",
    description:
      "Multi-client cockpit, document signatures, payments, and tax-form auto-drafting. From $99/mo.",
    url: "/pricing/firms",
    type: "website",
  },
  // NOINDEX, deliberately, pending a pricing decision. Do not flip this
  // back without reading the next paragraph.
  //
  // Every price on this page (Starter $99, Growth $249, Firm $599) is
  // absent from PLAN_PRICING in lib/plans/limits.ts, which is the billing
  // engine and tops out at Practice $299/mo. There is no Stripe price
  // behind any of these tiers, so the "Start free trial" buttons below
  // lead to a checkout that cannot charge what the page advertises.
  //
  // The page is already orphaned (nothing links to it, and it is not in
  // app/sitemap.ts) but it was `index: true` with its own canonical, so
  // crawlers and AI answer engines could still reach it and quote the
  // $599 figure back to a prospect. Noindex is containment, not a
  // decision: it stops the wrong number propagating while the real firm
  // pricing is settled.
  //
  // To resolve, pick one and delete this block:
  //   - Practice $299 is the truth  -> rewrite around it, or redirect to
  //     /pricing#practice in next.config.ts, and re-enable indexing
  //   - this ladder is the truth    -> add the SKUs to PLAN_PRICING and
  //     Stripe FIRST, then re-enable indexing
  //
  // lib/seo/pricing-schema.test.ts guards the home page's structured
  // data against this same class of drift. It cannot see this page,
  // because these prices live in JSX rather than in the schema.
  robots: {
    index: false,
    follow: true,
    googleBot: {
      index: false,
      follow: true,
    },
  },
};

type Tier = {
  id: string;
  name: string;
  monthly: string;
  blurb: string;
  highlights: string[];
  cta: { label: string; href: string };
};

const TIERS: Tier[] = [
  {
    id: "starter",
    name: "Starter",
    monthly: "$99",
    blurb: "For solo CPAs onboarding their first few clients.",
    highlights: [
      "Up to 10 active engagements",
      "5 preparer seats",
      "Documenso e-signature (50 envelopes/mo)",
      "Stripe Connect invoicing (3% platform fee)",
      "Branded client portal under taxottic.com",
    ],
    cta: { label: "Start free trial", href: "/firms/request-account" },
  },
  {
    id: "growth",
    name: "Growth",
    monthly: "$249",
    blurb: "When your roster outgrows the spreadsheet.",
    highlights: [
      "Up to 50 active engagements",
      "15 preparer seats",
      "Documenso e-signature (250 envelopes/mo)",
      "Zoom + Google + Microsoft scheduling",
      "Priority email support",
    ],
    cta: { label: "Start free trial", href: "/firms/request-account" },
  },
  {
    id: "firm",
    name: "Firm",
    monthly: "$599",
    blurb: "For multi-partner practices doing year-end at scale.",
    highlights: [
      "Up to 200 active engagements",
      "Unlimited preparer seats",
      "Documenso e-signature (unlimited)",
      "Auto-drafted Schedule C, K-1, 1099-NEC/MISC",
      "Phone + email support",
      "Quarterly health check with the Taxottic team",
    ],
    cta: { label: "Start free trial", href: "/firms/request-account" },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthly: "Custom",
    blurb: "Bring-your-own-domain + dedicated CSM.",
    highlights: [
      "Unlimited engagements + preparers",
      "DocuSign e-signature option",
      "BYO custom domain (firm.smithcpa-secure.com)",
      "MeF e-filing assistance",
      "Dedicated CSM, 4-hour SLA",
      "Custom legal review + compliance pack",
    ],
    cta: {
      label: "Talk to us",
      href: "mailto:contact@taxottic.com?subject=Enterprise firm pricing",
    },
  },
];

export default function FirmPricingPage() {
  return (
    <main id="main" className="min-h-screen">
      <header className="max-w-5xl mx-auto px-4 sm:px-6 pt-8 sm:pt-10">
        <div className="flex items-center justify-between">
          <Wordmark size="sm" />
          <span className="sr-only">Taxottic home</span>
          <nav className="text-sm flex items-center gap-3">
            <Link href="/pricing" className="text-ink-soft hover:text-forest-800">
              Individuals
            </Link>
            <Link
              href="/firms/request-account"
              className="btn-primary text-sm"
            >
              Request account
            </Link>
          </nav>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Pricing for firms
        </div>
        <h1 className="display mt-2 text-4xl sm:text-5xl text-forest-900 leading-tight">
          A cockpit your firm will actually use.
        </h1>
        <p className="mt-4 text-base text-ink-soft leading-relaxed max-w-2xl">
          Multi-client roster, branded portals, e-signature,
          scheduling, invoicing, and tax-form auto-drafting in one
          calm place. Pick a tier; cancel anytime; pay annually for
          ~15% off.
        </p>

        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((t) => (
            <article
              key={t.id}
              className="card p-5 sm:p-6 flex flex-col"
            >
              <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
                {t.name}
              </div>
              <div className="mt-2 display text-3xl text-forest-900">
                {t.monthly}
                {t.monthly !== "Custom" ? (
                  <span className="text-sm text-ink-muted font-normal">
                    {" "}
                    / mo
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-ink-soft leading-relaxed">
                {t.blurb}
              </p>
              <ul className="mt-4 grid gap-1.5 text-xs text-forest-900 leading-relaxed flex-1">
                {t.highlights.map((h) => (
                  <li key={h} className="flex items-start gap-1.5">
                    <span aria-hidden="true" className="text-gold-700 mt-0.5">
                      ✓
                    </span>
                    <span>{h}</span>
                  </li>
                ))}
              </ul>
              <Link
                href={t.cta.href}
                className="btn-primary text-sm mt-5 text-center"
              >
                {t.cta.label} →
              </Link>
            </article>
          ))}
        </div>

        <section className="mt-14 card p-6 sm:p-8">
          <h2 className="display text-2xl text-forest-900">
            How invoicing works
          </h2>
          <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-3xl">
            You connect a Stripe Express account; your clients pay
            into it directly. We charge a 3% platform fee on each
            collected invoice (in addition to Stripe&apos;s own
            processing fee). No setup costs. No monthly minimums on
            the payment rail.
          </p>
        </section>

        <section className="mt-10 card p-6 sm:p-8">
          <h2 className="display text-2xl text-forest-900">
            BYO domain (Enterprise)
          </h2>
          <p className="mt-3 text-sm text-ink-soft leading-relaxed max-w-3xl">
            Enterprise tier includes Vercel-issued certificates for
            a custom subdomain you bring (firm.example.com). We
            handle CNAME wiring, SSL renewal, and the host-header
            routing that maps the domain back to your firm cockpit.
          </p>
        </section>

        <section className="mt-10">
          <h2 className="display text-2xl text-forest-900">FAQ</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Faq
              q="Is there a free trial?"
              a="Yes, every tier ships with a 14-day trial. No card required for Starter; the higher tiers ask for a card on day-1 so the Stripe Customer Portal is wired before you need it."
            />
            <Faq
              q="Can I bring my existing clients?"
              a="Yes. Bulk-import up to 200 clients per CSV paste. We dedupe within the batch, route existing Taxottic users straight to an engagement, and send branded invitations to prospects."
            />
            <Faq
              q="Do you charge per preparer?"
              a="Starter caps at 5 preparers; Growth at 15; Firm and Enterprise are unlimited. There's no per-seat add-on math."
            />
            <Faq
              q="Can I cancel anytime?"
              a="Yes. Cancellation is one click in the Stripe Customer Portal we link from the cockpit. Your data is retained for 30 days post-cancel for re-activation."
            />
          </div>
        </section>
      </section>

      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@type": "Product",
          name: "Taxottic for accounting firms",
          description:
            "Multi-client cockpit with branded portals, e-signature, scheduling, invoicing, and tax-form auto-drafting.",
          offers: TIERS.filter((t) => t.monthly !== "Custom").map((t) => ({
            "@type": "Offer",
            name: t.name,
            price: t.monthly.replace("$", ""),
            priceCurrency: "USD",
            url: `https://taxottic.com/pricing/firms#${t.id}`,
          })),
        }}
      />
    </main>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <article className="card p-4">
      <h3 className="display text-base text-forest-900">{q}</h3>
      <p className="mt-1 text-sm text-ink-soft leading-relaxed">{a}</p>
    </article>
  );
}
