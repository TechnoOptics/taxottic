import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export const metadata = {
  title: "Taxottic for accounting firms",
  description:
    "Manage every client engagement, document, and deadline in one calm place. Subdomain-branded portal, multi-client cockpit, auto-drafted tax forms, e-signature, secure document inbox.",
  alternates: { canonical: "/firms" },
  openGraph: {
    title: "Taxottic for accounting firms",
    description:
      "The firm cockpit accountants actually want. Per-client portals, auto-drafted forms, e-signature, scheduling, invoicing.",
    type: "website",
  },
};

// /firms — public marketing landing for accounting firms.
//
// Sister page to /pricing and /example: gives a firm operator
// enough signal to decide whether to apply for an account without
// us having to demo every feature. Single column, short copy,
// honest about what's shipped vs in-build.

const PHASES = [
  {
    badge: "Live",
    title: "Multi-client cockpit",
    body: "See every engagement at a glance — pending invitations, active books, tax-ready %, last activity, who's assigned. Urgency sort floats the ones needing a nudge to the top.",
  },
  {
    badge: "Live",
    title: "Read-only book access",
    body: "When a client accepts an engagement, your firm gets read-only access to their income, expenses, bank feed, and prior-year documents. Engagement-scoped — no cross-tenant leakage.",
  },
  {
    badge: "Live",
    title: "Client onboarding (one or many)",
    body: "Invite a client by email. We sniff whether they're already on Taxottic and route accordingly. Bulk-import via CSV ships in the next release.",
  },
  {
    badge: "Phase 5 — in build",
    title: "Auto-drafted tax forms + e-signature",
    body: "Schedule C, K-1, 1099-NEC, engagement letters, organizers — auto-populated from the client's books. Documenso for native e-signature, DocuSign on the enterprise tier.",
  },
  {
    badge: "Phase 6",
    title: "Scheduling (Teams + Zoom + Google)",
    body: "Booking links per preparer. Sync availability from Microsoft 365, Google Calendar, and Zoom in one place. The client picks a slot and the meeting lands on your calendar.",
  },
  {
    badge: "Phase 7",
    title: "Invoice + collect",
    body: "Itemized invoices for tax prep, audit response, and advisory. Client pays via Stripe; transparent platform fee.",
  },
];

export default function FirmsLandingPage() {
  return (
    <main id="main" className="min-h-screen">
      {/* Hero */}
      <section className="relative bg-forest-900 text-cream">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-16 sm:pt-24 pb-20 sm:pb-28">
          <Wordmark size="md" tone="cream" />
          <div className="mt-8 text-[10px] uppercase tracking-[0.32em] text-gold-300">
            Taxottic for accounting firms
          </div>
          <h1 className="display mt-3 text-3xl sm:text-5xl lg:text-6xl leading-[1.05] max-w-3xl">
            The firm cockpit accountants actually want.
          </h1>
          <p className="mt-5 text-base sm:text-lg leading-relaxed max-w-2xl text-cream/80">
            One subdomain. One roster. Every client&apos;s books,
            documents, and deadlines in one calm place. Auto-drafted
            tax forms, e-signature, scheduling, and invoicing — all
            wired into the engagements your clients already trust you
            with.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/firms/request-account"
              className="rounded-full bg-cream text-forest-900 hover:bg-cream/95 px-6 py-3 text-sm font-medium shadow-lg"
            >
              Request a firm account →
            </Link>
            <Link
              href="https://taxottic.com/book?for=firm"
              className="rounded-full border border-cream/30 px-6 py-3 text-sm font-medium hover:bg-cream/10"
            >
              Book a 20-minute demo
            </Link>
          </div>
          <p className="mt-6 text-[11px] text-cream/60 leading-relaxed max-w-xl">
            Pilot pricing. Approved within one business day.
            Yourfirm.taxottic.com goes live as soon as we provision.
          </p>
        </div>
      </section>

      {/* Phases / what's live + what's coming */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          What you get
        </div>
        <h2 className="display mt-2 text-2xl sm:text-4xl text-forest-900 max-w-2xl">
          A firm portal we&apos;re building with our pilot partners.
        </h2>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
          Some pieces are already live in the cockpit; some are in
          active build. We mark each one honestly so you know
          exactly what you&apos;d be using on day one vs day ninety.
        </p>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PHASES.map((p) => (
            <li key={p.title} className="card p-5 sm:p-6">
              <span
                className={
                  "inline-flex items-center px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] rounded-full border " +
                  (p.badge === "Live"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                    : "border-gold-200 bg-cream/60 text-gold-700")
                }
              >
                {p.badge}
              </span>
              <h3 className="display mt-3 text-lg text-forest-900 leading-snug">
                {p.title}
              </h3>
              <p className="mt-2 text-sm text-ink-soft leading-relaxed">
                {p.body}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* Why us */}
      <section className="bg-cream-50 border-y border-forest-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            Why Taxottic
          </div>
          <h2 className="display mt-2 text-2xl sm:text-4xl text-forest-900 max-w-2xl">
            Built for firms that prefer calm over chaos.
          </h2>
          <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <Pitch
              title="One subdomain, one roster"
              body="Yourfirm.taxottic.com is yours. Clients log in there; your team lives there. No app-switching, no per-product seat sprawl."
            />
            <Pitch
              title="IRS-cited deductions"
              body="1,025 deduction categories sourced from IRS publications. Bella, our tax-research assistant, cites the IRC section for every recommendation."
            />
            <Pitch
              title="OBBBA + 2026 tax year baked in"
              body="State brackets, Section 199A, SE-tax wage-base cap, EITC, AOTC, Lifetime Learning, Saver's — all updated for the One Big Beautiful Bill amendments."
            />
            <Pitch
              title="Audit-grade activity log"
              body="Every cross-tenant read by a firm member is logged with the admin's identity, the company, and the path. Tenants see who looked at their data."
            />
            <Pitch
              title="Real bank feeds"
              body="Plaid + Stripe Connect bring transactions in automatically. Bella auto-categorizes; high-confidence rows apply themselves."
            />
            <Pitch
              title="Engagement-scoped access"
              body="When a client accepts a tax-prep engagement, your firm gets read-only access to their books for that tax year. Engagement ends → access ends."
            />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16 sm:py-24 text-center">
        <h2 className="display text-2xl sm:text-3xl text-forest-900 max-w-xl mx-auto">
          Ready to see your firm&apos;s name on a subdomain?
        </h2>
        <p className="mt-3 text-sm text-ink-soft max-w-md mx-auto leading-relaxed">
          One business day from application to provisioned portal.
          Tell us about your firm and we&apos;ll take it from there.
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/firms/request-account"
            className="btn-primary text-sm"
          >
            Request a firm account →
          </Link>
          <Link
            href="https://taxottic.com/book?for=firm"
            className="btn-ghost text-sm"
          >
            Book a 20-minute demo
          </Link>
        </div>
      </section>
    </main>
  );
}

function Pitch({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="display text-lg text-forest-900 leading-snug">
        {title}
      </h3>
      <p className="mt-2 text-sm text-ink-soft leading-relaxed">{body}</p>
    </div>
  );
}
