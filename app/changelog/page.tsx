import { MarketingNav } from "@/components/MarketingNav";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { SignInIconLink } from "@/components/SignInIconLink";

export const metadata = {
  title: "Changelog, what's new in Taxottic",
  description:
    "Public release notes for Taxottic. Every shipped feature, fix, and security improvement, with dates. Updated as we ship.",
  alternates: { canonical: "/changelog" },
  openGraph: {
    title: "Taxottic Changelog",
    description: "Public release notes for Taxottic. Every shipped feature, fix, and security improvement, with dates.",
    url: "/changelog",
    type: "website",
  },
  robots: { index: true, follow: true },
};

// Public changelog. The May 2026 audit (P2) flagged the absence of a
// public changelog as a missed trust signal, "shipped twice this
// month" is itself a credibility marker, and search engines pick up
// the cadence.
//
// Entries are hand-curated; we don't auto-import commit messages
// because not every commit is user-visible (CI, refactors, tests). The
// rule of thumb: if a user could plausibly notice the change, it
// belongs here.
//
// New entries go at the TOP. Keep each line user-facing and
// jargon-light; the technical detail lives in commit messages, not
// here.

type Tag = "shipped" | "fix" | "ops" | "security";

type Entry = {
  date: string; // ISO yyyy-mm-dd
  title: string;
  body: string;
  tags: Tag[];
};

const ENTRIES: Entry[] = [
  {
    date: "2026-08-06",
    title: "Tick the rows you mean, and finish an import when it is done",
    body: "Every expense candidate on an import now has a checkbox, with select-all, and one bar at the bottom that applies, accepts Bella's category, or ignores whatever you ticked. The old button read 'Apply manually selected' while nothing on the page could be selected, and it only counted rows you had already saved one at a time, so an import with thirteen suggestions waiting showed a button for one. Refunds and rows already booked have no checkbox at all: a refund is not a deduction, and select-all must not be able to turn one into one. When nothing is left unresolved, a Complete step files the import away, and it can be reopened at any time. The row counts on the import list are now counted from the rows themselves, which fixes imports that said '0 applied' while dozens of their rows were already booked.",
    tags: ["shipped", "fix"],
  },
  {
    date: "2026-08-06",
    title: "The home page shows the people it is built for",
    body: "The front page now carries real photographs instead of type alone: someone working through their own estimated-tax paperwork, a one-person workshop, a practice going through a client's file. They change with the view you pick, and a new 'Three ways in' section lower down lets you switch between the personal, business, and firm views without scrolling back to the top. Every photograph is a real photograph, licensed for commercial use, with the source and photographer recorded.",
    tags: ["shipped"],
  },
  {
    date: "2026-08-01",
    title: "Clearer answers about location, and who can see your drives",
    body: "A new policy page, Location tracking and team visibility, sets out exactly what automatic mileage tracking records, how long each part of it is kept, and what a manager at your company or an engaged accounting firm can see. Short version: only drives you mark as business become visible to your company, and personal or unclassified drives never leave your own account. The screen that asks for location permission now says the same thing before you agree to it. The privacy policy, cookie list, and subprocessor list have also been brought in line with what the app actually does, including the vendors that were live but unlisted.",
    tags: ["shipped"],
  },
  {
    date: "2026-08-01",
    title: "Chat opens on your conversations, not one company room",
    body: "Chat now lands on a list of your conversations, with 'New message' and 'New group' as the first thing you see. Direct messages and private groups already existed but were hidden behind two small links, so chat felt like a single company-wide room. General is still there with all its history, now as one conversation among the rest. A direct message or private group is readable only by the people in it, enforced in the database, and losing your seat on a company now ends your access to its conversations immediately.",
    tags: ["shipped", "security"],
  },
  {
    date: "2026-05-12",
    title: "May 2026 audit fixes",
    body: "Public pricing page, /help, /changelog, /example, DMCA + accessibility policies, OpenGraph image, canonical links, WCAG-compliant viewport (zoom no longer capped), and stricter CORS on app responses. Plus a short 'Single sign-on across Techno Optics products' section in /legal/security explaining why the same Google account signs into multiple products of ours.",
    tags: ["shipped", "security"],
  },
  {
    date: "2026-05-11",
    title: "Switch accounts",
    body: "New 'Switch accounts' item in the profile menu. Clears the current session and forces Google / Microsoft to show the account picker so you can pick a different account instead of being silently re-authenticated.",
    tags: ["shipped"],
  },
  {
    date: "2026-05-11",
    title: "CI gate for tax math",
    body: "GitHub Actions now runs the 125-test Vitest suite plus tsc on every PR. A change that breaks the tax math or any type can't merge silently. Lint reports but isn't yet blocking, backlog cleanup planned before flipping it on.",
    tags: ["ops"],
  },
  {
    date: "2026-05-10",
    title: "Profile menu portal switcher",
    body: "Super-admins can now jump between Consumer, Enterprise, and HQ from the profile menu. The 'Send feedback' bubble that used to float above Bella moved into the same menu, one launcher, less clutter.",
    tags: ["shipped"],
  },
  {
    date: "2026-05-09",
    title: "Math verification: 125 tests, three layers",
    body: "Layer 1, IRS-published worked examples (EITC, Saver's Credit, AOTC, state brackets). Layer 2, end-to-end fixture scenarios (W-2, sole prop, combined, AMT, LTCG, EITC). Layer 3, property-based invariants (refund/owed reconciliation, CTC caps, QBI ≤ 20%, monotonicity). Caught one real bug along the way: long-term capital gains weren't being added to AGI for phase-out math.",
    tags: ["ops", "fix"],
  },
  {
    date: "2026-05-07",
    title: "State tax: real brackets for 10 states",
    body: "Replaced the flat-rate fallback for CA, NY, NJ, MA, MN, OR, HI, DC, MD, CT with real bracket tables. CA mental-health surcharge and MA Fair Share Amendment included.",
    tags: ["shipped"],
  },
  {
    date: "2026-05-06",
    title: "Education credits (§ 25A)",
    body: "AOTC + Lifetime Learning Credit with full phase-out, refundable / non-refundable split, and MFS disqualifier.",
    tags: ["shipped"],
  },
  {
    date: "2026-05-05",
    title: "Saver's Credit (§ 25B)",
    body: "Full math, 10/20/50% bracket lookup against 2025/2026 AGI tables.",
    tags: ["shipped"],
  },
  {
    date: "2026-05-04",
    title: "EITC (§ 32)",
    body: "Refundable Earned Income Tax Credit with investment-income disqualifier, MFS exclusion, and per-user 'why zero' copy when ineligible.",
    tags: ["shipped"],
  },
  {
    date: "2026-05-03",
    title: "Tax year 2026 + OBBBA",
    body: "Federal constants updated to Rev. Proc. 2025-32 with the One Big Beautiful Bill Act amendments (CTC raised to $2,200, the $400 QBI minimum, OBBBA mileage rate). All forecast tiles now branch on the configured tax year.",
    tags: ["shipped"],
  },
  {
    date: "2026-05-01",
    title: "QA bug-fix sweep",
    body: "Microsoft SSO gated until the Azure provider is fully wired, reminders dedupe (no more 8× duplicated quarterly), greeting no longer says 'Contact', PWA manifest 404s fixed, default 404 page improved, robots.txt + sitemap.xml live, feedback button restored.",
    tags: ["fix"],
  },
  {
    date: "2026-04-30",
    title: "Stripe Connect, bank provider option",
    body: "Stripe Connect added as an alternative to Plaid for users whose bank already lives in a Stripe-connected account. Read-only scope, OAuth flow, transaction sync.",
    tags: ["shipped"],
  },
  {
    date: "2026-04-29",
    title: "Cross-tenant data-leak fix",
    body: "Signout now correctly clears cookies on the response, busts the Router Cache, and sets no-store so the browser bfcache can't restore the previous user's HTML after a sign-out / sign-in cycle. RLS was always correct; the failure mode was browser-side.",
    tags: ["security", "fix"],
  },
];

const TAG_LABEL: Record<Tag, string> = {
  shipped: "Shipped",
  fix: "Fix",
  ops: "Ops",
  security: "Security",
};

const TAG_TONE: Record<Tag, string> = {
  shipped: "bg-emerald-50 border-emerald-100 text-emerald-700",
  fix: "bg-amber-50 border-amber-100 text-amber-800",
  ops: "bg-forest-50 border-forest-100 text-forest-700",
  security: "bg-red-50 border-red-100 text-red-700",
};

export default function ChangelogPage() {
  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      <header
        className="relative"
        style={{
          background:
            "var(--navy-band)",
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
          <MarketingNav />
          <SignInIconLink />
        </div>
      </header>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pt-12 sm:pt-16 pb-8">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          Changelog
        </div>
        <h1 className="display mt-2 text-3xl sm:text-5xl text-forest-900 leading-tight">
          What we shipped, when.
        </h1>
        <p className="mt-4 text-sm sm:text-base text-ink-soft max-w-xl leading-relaxed">
          We update Taxottic in small, frequent steps. This page is the
          public record. Subscribe to email-only updates from{" "}
          <Link
            href="mailto:contact@taxottic.com?subject=Subscribe%20me%20to%20changelog%20emails"
            className="underline hover:text-forest-900"
          >
            contact@taxottic.com
          </Link>{" "}
          (we reply with a one-click confirm).
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 grid gap-7">
        {ENTRIES.map((e, i) => (
          <article key={i} className="card p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="display text-lg text-forest-900">{e.title}</h2>
              <time
                dateTime={e.date}
                className="text-[11px] text-ink-muted tracking-wide"
              >
                {new Intl.DateTimeFormat("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${e.date}T00:00:00Z`))}
              </time>
            </div>
            <p className="mt-2 text-sm text-ink-soft leading-relaxed">
              {e.body}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {e.tags.map((t) => (
                <span
                  key={t}
                  className={
                    "text-[10px] uppercase tracking-[0.18em] px-2 py-0.5 rounded-full border " +
                    TAG_TONE[t]
                  }
                >
                  {TAG_LABEL[t]}
                </span>
              ))}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}
