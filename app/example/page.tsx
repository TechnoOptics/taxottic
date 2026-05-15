import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";

export const metadata = {
  title: "Example dashboard — see Taxottic before you sign up",
  description:
    "A read-only sample dashboard for Maple Lane Design Co. (fictional sole proprietor). See bank-synced forecasts, IRS-cited deductions, and Schedule C — no signup needed.",
  alternates: { canonical: "/example" },
  openGraph: {
    title: "Taxottic — Example dashboard",
    description:
      "A read-only sample dashboard for a fictional sole proprietor. No signup needed.",
    url: "/example",
    type: "website",
  },
  robots: { index: true, follow: true },
};

// Public /example page. The May 2026 audit flagged P2 + the hero CTA
// soft-claim: "Take a look around" used to point to /login. This is
// the real read-only sample so the link finally matches its copy.
//
// Data here is all hard-coded and fictional. The mockups in
// app/page.tsx (Company X) deliberately overlap visually so a prospect
// who lands on the home page recognises the same product when they
// click through. Don't share components with /dashboard — we WANT
// these to drift from the live UI so a real user can't be tricked
// into thinking sample data is theirs.

type SampleTx = {
  merchant: string;
  date: string;
  amount: string;
  category: string;
  applied: boolean;
};

const SAMPLE_TX: SampleTx[] = [
  {
    merchant: "Adobe Creative Cloud",
    date: "May 8",
    amount: "$89.99",
    category: "Software / subscriptions",
    applied: true,
  },
  {
    merchant: "AWS · S3 + CloudFront",
    date: "May 7",
    amount: "$342.50",
    category: "Software / subscriptions",
    applied: true,
  },
  {
    merchant: "Delta Airlines · BOS → SFO",
    date: "May 6",
    amount: "$612.40",
    category: "Travel",
    applied: true,
  },
  {
    merchant: "Marriott Boston Seaport",
    date: "May 6",
    amount: "$384.00",
    category: "Travel",
    applied: true,
  },
  {
    merchant: "Sweetgreen · with client",
    date: "May 5",
    amount: "$24.50",
    category: "Meals (50%)",
    applied: true,
  },
  {
    merchant: "Whole Foods",
    date: "May 5",
    amount: "$72.18",
    category: "Personal — not deductible",
    applied: false,
  },
];

export default function ExamplePage() {
  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <header
        className="relative"
        style={{
          background:
            "linear-gradient(180deg, #1a4031 0%, #0f2d24 60%, #0a201a 100%)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <Link href="/" aria-label="Taxottic home">
            <Wordmark size="md" tone="cream" />
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href="/pricing"
              className="text-sm text-cream/80 hover:text-cream"
            >
              Pricing
            </Link>
            <Link href="/login" className="btn-primary text-sm">
              Sign up free
            </Link>
          </div>
        </div>
      </header>

      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-4">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Example dashboard · Read-only sample
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight">
          What Taxottic looks like on a real Tuesday.
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-2xl leading-relaxed">
          The data below belongs to a fictional sole proprietor (
          <em>Maple Lane Design Co.</em>), May 2026. Everything is
          hard-coded — clicking through doesn&apos;t change anything. When
          you&apos;re ready to see your own numbers,{" "}
          <Link
            href="/login"
            className="underline font-medium hover:text-forest-900"
          >
            create a free account
          </Link>
          .
        </p>
      </section>

      {/* Greeting + recap */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Your workspace
        </div>
        <h2 className="display mt-2 text-2xl text-forest-900">
          Good afternoon, Riley.
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          Calm and consistent. That is the whole game.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <RecapCard
            tone="info"
            title="3 reminders in the next 30 days"
            body="Q2 estimated tax due June 15; client deposit reconciliation; quarterly mileage true-up."
          />
          <RecapCard
            tone="info"
            title="Bella flagged 4 likely deductions"
            body="Two software subscriptions, a co-working day pass, and a client lunch — all auto-applied with sources."
          />
        </div>
      </section>

      {/* Forecast tiles */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <h2 className="display text-xl text-forest-900">
          Live forecast — Tax year 2026
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <ForecastTile
            kicker="Federal owed"
            amount="$14,820"
            delta="↓ $620 from last sync"
          />
          <ForecastTile
            kicker="State owed (MA)"
            amount="$3,210"
            delta="↓ $135 · synced 2 min ago"
          />
          <ForecastTile
            kicker="Q2 estimated payment"
            amount="$4,400"
            delta="Due Jun 15, 2026"
          />
        </div>

        <div className="mt-5 card p-5 sm:p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
              YTD deductions claimed
            </div>
            <span className="text-[11px] text-ink-muted">
              7 of 8 starter categories
            </span>
          </div>
          <div className="display mt-2 text-2xl text-forest-900 tabular-nums">
            $42,807
          </div>
          <ul className="mt-4 grid gap-2">
            {[
              { label: "Software / subscriptions", amount: "$12,840", w: 100 },
              { label: "Travel", amount: "$8,420", w: 66 },
              { label: "Home office (Form 8829)", amount: "$3,840", w: 30 },
              { label: "Meals (50% applied)", amount: "$1,205", w: 9 },
            ].map((r) => (
              <li
                key={r.label}
                className="min-w-0 flex items-center gap-2 sm:gap-3 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate text-forest-900">
                  {r.label}
                </span>
                <span className="hidden sm:inline-block flex-none rounded-full bg-forest-50 overflow-hidden w-24 h-1.5">
                  <span
                    className="block h-full bg-gold-400"
                    style={{ width: `${r.w}%` }}
                  />
                </span>
                <span className="shrink-0 w-16 text-right tabular-nums text-forest-700">
                  {r.amount}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-2 text-[11px] text-ink-muted">
            + 3 more categories
          </div>
        </div>
      </section>

      {/* Bank feed */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        <h2 className="display text-xl text-forest-900">Bank feed</h2>
        <div className="mt-3 card p-5">
          <div className="flex items-center justify-between text-xs text-ink-muted">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Synced 14 minutes ago · Chase Business
            </span>
            <span>6 new this week</span>
          </div>
          <ul className="mt-4 grid gap-2">
            {SAMPLE_TX.map((t, i) => (
              <li
                key={i}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-white border border-forest-100 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1 basis-full sm:basis-auto">
                  <div className="text-sm text-forest-900 truncate">
                    {t.merchant}
                  </div>
                  <div className="text-[11px] text-ink-muted mt-0.5">
                    {t.date}
                    <span className="text-gold-500"> · </span>
                    {t.category}
                  </div>
                </div>
                <div className="text-sm tabular-nums text-forest-900 shrink-0">
                  {t.amount}
                </div>
                <span
                  className={
                    "text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 shrink-0 " +
                    (t.applied
                      ? "text-emerald-700 bg-emerald-50 border border-emerald-100"
                      : "text-ink-muted bg-cream/70 border border-forest-100")
                  }
                >
                  {t.applied ? "applied" : "skipped"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-12">
        <div className="card p-6 sm:p-8 sm:p-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div>
            <h2 className="display text-2xl text-forest-900">
              See your own version.
            </h2>
            <p className="mt-2 text-sm text-ink-soft max-w-xl leading-relaxed">
              Connect a bank in 90 seconds — your live forecast,
              deductions, and reminders populate in minutes. No credit
              card.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/login" className="btn-primary">
              Sign up free
            </Link>
            <Link href="/pricing" className="btn-ghost">
              See pricing
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function RecapCard({
  tone,
  title,
  body,
}: {
  tone: "info" | "warn";
  title: string;
  body: string;
}) {
  return (
    <div
      className={
        "card p-4 flex items-start gap-3 " +
        (tone === "warn" ? "border-red-200" : "")
      }
    >
      <div
        className={
          "mt-1 size-2 rounded-full shrink-0 " +
          (tone === "warn" ? "bg-red-500" : "bg-gold-400")
        }
      />
      <div className="min-w-0">
        <div className="display text-base text-forest-900">{title}</div>
        <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function ForecastTile({
  kicker,
  amount,
  delta,
}: {
  kicker: string;
  amount: string;
  delta: string;
}) {
  return (
    <article className="card p-5">
      <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
        {kicker}
      </div>
      <div className="display mt-2 text-3xl text-forest-900 tabular-nums">
        {amount}
      </div>
      <div className="mt-1 text-[11px] text-ink-muted">{delta}</div>
    </article>
  );
}
