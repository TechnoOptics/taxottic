import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { MarketingNav } from "@/components/MarketingNav";
import { SignInIconLink } from "@/components/SignInIconLink";

/**
 * Shared chrome for /guides/* articles. Server component (no client
 * interactivity): a navy gradient header matching /help, a breadcrumb,
 * a readable article column, an end-of-article call-to-action, and the
 * standard "not tax advice" disclaimer every Taxottic surface carries.
 *
 * Typographic helpers (H2/H3/P/UL/LI/Callout) are exported so each
 * article writes semantic, consistently-styled prose without repeating
 * class strings, and so the rendered text mirrors the FAQ/Article
 * JSON-LD the article ships (Google rejects schema that diverges from
 * visible content).
 */
/** A matching free calculator to surface inline at the top of a guide -
 *  sends the high-intent mid-article reader straight to the tool and
 *  interlinks the editorial + tool clusters for topical authority. */
export type GuideCalc = { href: string; label: string; blurb: string };

export function GuideShell({
  title,
  kicker,
  lead,
  updated,
  calc,
  children,
}: {
  title: string;
  kicker: string;
  lead: string;
  updated: string;
  calc?: GuideCalc;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <header
        className="relative"
        style={{
          background:
            "linear-gradient(180deg, #2a3a5e 0%, #1d2843 60%, #121a2a 100%)",
          // Native iOS overlays the WebView under the status bar, pad by
          // the real safe-area inset so the wordmark clears the notch /
          // Dynamic Island (matches app/page.tsx + AppHeader). 0 on web.
          paddingTop:
            "max(var(--app-safe-top, 0px), env(safe-area-inset-top, 0px))",
          paddingLeft: "env(safe-area-inset-left, 0px)",
          paddingRight: "env(safe-area-inset-right, 0px)",
        }}
      >
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex items-center justify-between">
          <Wordmark size="md" tone="cream" />
          <MarketingNav current="guides" />
          {/*
            Was a plain "Sign in" text link, which is the exact thing
            SignInIconLink was written to replace: next to the full
            wordmark on a narrow phone it had no room and wrapped to
            "Sign\nin". Every other marketing header already uses the
            icon button, so the guides were the last place the old
            wrapping version survived.
          */}
          <SignInIconLink />
        </div>
      </header>

      <article className="max-w-3xl mx-auto px-4 sm:px-6 pt-10 sm:pt-14 pb-8">
        {/* Breadcrumb, mirrors the BreadcrumbList JSON-LD each article ships. */}
        <nav
          aria-label="Breadcrumb"
          className="text-xs text-ink-muted flex items-center gap-1.5"
        >
          <Link href="/" className="hover:text-forest-900">
            Home
          </Link>
          <span aria-hidden="true">›</span>
          <Link href="/guides" className="hover:text-forest-900">
            Guides
          </Link>
          <span aria-hidden="true">›</span>
          <span className="text-ink-soft">{kicker}</span>
        </nav>

        <h1 className="display mt-4 text-3xl sm:text-5xl text-forest-900 leading-tight">
          {title}
        </h1>
        <p className="mt-4 text-base sm:text-lg text-ink-soft leading-relaxed">
          {lead}
        </p>
        <div className="mt-3 text-xs text-ink-muted">Updated {updated}</div>
        <div aria-hidden="true" className="gold-flourish mt-5">
          <span />
        </div>

        {/* Matching free-calculator card, the in-content path from a
            search reader to the interactive tool. */}
        {calc ? (
          <Link
            href={calc.href}
            className="group card mt-7 p-5 flex items-center gap-4 hover:border-gold-300 transition-colors"
          >
            <div
              aria-hidden="true"
              className="shrink-0 grid place-items-center h-11 w-11 rounded-xl bg-forest-900 text-cream"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="4" y="2" width="16" height="20" rx="2" />
                <line x1="8" y1="6" x2="16" y2="6" />
                <line x1="8" y1="10" x2="8" y2="10" />
                <line x1="12" y1="10" x2="12" y2="10" />
                <line x1="16" y1="10" x2="16" y2="10" />
                <line x1="8" y1="14" x2="8" y2="14" />
                <line x1="12" y1="14" x2="12" y2="14" />
                <line x1="8" y1="18" x2="12" y2="18" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.22em] text-gold-700">
                Free calculator
              </div>
              <div className="text-base font-medium text-forest-900">
                {calc.label}
              </div>
              <div className="text-sm text-ink-soft leading-snug mt-0.5">
                {calc.blurb}
              </div>
            </div>
            <span className="ml-auto shrink-0 text-gold-700 group-hover:text-gold-900 text-sm hidden sm:inline">
              Open →
            </span>
          </Link>
        ) : null}

        <div className="mt-8 grid gap-5">{children}</div>

        {/* End-of-article CTA, the conversion path from a search visitor. */}
        <aside className="card mt-12 p-6 sm:p-7">
          <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
            See it on your own numbers
          </div>
          <h2 className="display mt-1 text-xl text-forest-900">
            Taxottic forecasts this for you, all year
          </h2>
          <p className="mt-2 text-sm text-ink-soft leading-relaxed">
            Connect a bank or upload a CSV and Taxottic keeps a running
            quarterly tax estimate in step with your income, surfacing
            IRS-cited deductions as you earn them. Free tier, no credit card.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Link href="/login" className="btn-primary text-sm px-4 h-10">
              Start free
            </Link>
            <Link href="/example" className="btn-ghost text-sm px-4 h-10">
              See a live example →
            </Link>
          </div>
        </aside>

        <p className="mt-8 text-[11px] text-ink-muted leading-relaxed">
          This guide is general information, not tax, legal, or accounting
          advice, and isn&apos;t a substitute for a licensed CPA or tax
          attorney. Tax rules change and depend on your situation; figures
          here are illustrative. Verify specifics against current IRS
          guidance or with your preparer.
        </p>
      </article>
    </main>
  );
}

// --- Typographic helpers ------------------------------------------------

export function H2({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2
      id={id}
      className="display text-xl sm:text-2xl text-forest-900 mt-6 scroll-mt-24"
    >
      {children}
    </h2>
  );
}

export function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-semibold text-forest-900 text-base mt-4">{children}</h3>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm sm:text-base text-ink-soft leading-relaxed">
      {children}
    </p>
  );
}

export function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="grid gap-2 text-sm sm:text-base text-ink-soft leading-relaxed list-disc pl-5 marker:text-gold-600">
      {children}
    </ul>
  );
}

export function LI({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>;
}

export function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gold-200 bg-gold-50/60 px-4 py-3 text-sm text-forest-900 leading-relaxed">
      {children}
    </div>
  );
}
