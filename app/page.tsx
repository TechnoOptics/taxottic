import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/Wordmark";

type Audience = "personal" | "enterprise";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/dashboard");

  const sp = await searchParams;
  const audience: Audience =
    sp.audience === "enterprise" ? "enterprise" : "personal";

  return (
    <main className="min-h-screen bg-[var(--color-cream)]">
      {/* Forest header band — visually merges into the Hero gradient below
          so the page opens with one continuous premium-green field. Same
          gradient + gold underline as the authenticated AppHeader, so the
          marketing site feels like the same product the user signs into. */}
      <header
        className="relative"
        style={{
          background:
            "linear-gradient(180deg, #1a4031 0%, #0f2d24 60%, #0a201a 100%)",
          borderBottom: "1px solid rgba(213, 187, 126, 0.14)",
        }}
      >
        <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between">
          <Wordmark size="md" tone="cream" />
          <Link
            href="/login"
            className="text-sm text-cream/80 hover:text-cream transition-colors"
          >
            Sign in
          </Link>
        </div>
        {/* Thin gold sweep — same signature line as the AppHeader. */}
        <div
          aria-hidden="true"
          className="absolute left-0 right-0 bottom-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(213,187,126,0.55) 35%, rgba(242,216,150,0.95) 50%, rgba(213,187,126,0.55) 65%, transparent 100%)",
          }}
        />
      </header>

      <Hero audience={audience} />
      <Capabilities audience={audience} />
      <ProofBand />
      <FomoBand audience={audience} />
      <FinalCta audience={audience} />
      <Footer />
    </main>
  );
}

// ---------------------------------------------------------------------------
// Hero
// ---------------------------------------------------------------------------

function Hero({ audience }: { audience: Audience }) {
  const personal = audience === "personal";
  return (
    <section className="relative overflow-hidden">
      {/* Forest gradient backdrop with subtle gold radial */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(180deg, #1a4031 0%, #0f2d24 60%, #0a201a 100%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 opacity-50"
        style={{
          backgroundImage:
            "radial-gradient(800px 320px at 20% 0%, rgba(213,187,126,0.18), transparent 70%), radial-gradient(700px 320px at 100% 100%, rgba(213,187,126,0.10), transparent 70%)",
        }}
      />
      <div className="max-w-6xl mx-auto px-6 pt-16 sm:pt-24 pb-20 sm:pb-28 text-cream">
        <AudienceToggle audience={audience} />

        <h1 className="display mt-8 text-4xl sm:text-6xl lg:text-7xl text-cream max-w-4xl leading-[1.05]">
          {personal ? (
            <>
              See what you{" "}
              <span className="gold-shine">actually owe.</span>
              <br />
              Keep what you&apos;ve actually earned.
            </>
          ) : (
            <>
              Every client. Every month-end.{" "}
              <span className="gold-shine">One calm dashboard.</span>
            </>
          )}
        </h1>

        <p className="mt-6 text-lg sm:text-xl text-cream/80 max-w-2xl leading-relaxed">
          {personal
            ? "Taxottic forecasts your taxes in real time, surfaces every deduction your bank statements already prove, and reminds you to set the money aside before it's gone. Built for freelancers, contractors, and small businesses."
            : "Multi-client management with transparency into every engagement. Branded firm portal, automated outreach, bulk operations — without your associates juggling fifty spreadsheet tabs."}
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          <Link href="/login" className="btn-primary">
            {personal ? "Start free — no card needed" : "Book a 15-min walkthrough"}
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center h-11 px-5 rounded-[0.625rem] border border-gold-300/30 text-cream hover:bg-white/5 transition-colors text-sm"
          >
            Sign in
          </Link>
        </div>

        <p className="mt-6 text-xs uppercase tracking-[0.2em] text-gold-300">
          {personal
            ? "Forecast in 60 seconds · Plaid-synced in 90 · Cancel any time"
            : "White-glove migration · Branded portal · Per-seat or per-client"}
        </p>
      </div>
    </section>
  );
}

function AudienceToggle({ audience }: { audience: Audience }) {
  const segments: { id: Audience; label: string }[] = [
    { id: "personal", label: "For me" },
    { id: "enterprise", label: "For my firm" },
  ];
  return (
    <div
      className="inline-flex p-1 rounded-full bg-white/8 border border-gold-300/20 backdrop-blur"
      role="tablist"
      aria-label="Choose audience"
    >
      {segments.map((s) => {
        const active = audience === s.id;
        return (
          <Link
            key={s.id}
            href={`/?audience=${s.id}`}
            scroll={false}
            role="tab"
            aria-selected={active}
            className={
              "px-5 py-2 rounded-full text-sm font-medium transition-all " +
              (active
                ? "bg-cream text-forest-900 shadow"
                : "text-cream/80 hover:text-cream hover:bg-white/5")
            }
          >
            {s.label}
          </Link>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

type Capability = {
  kicker: string;
  title: string;
  body: string;
  pull: string;
};

const PERSONAL: Capability[] = [
  {
    kicker: "Live Forecast",
    title: "Know what April will cost you, by July.",
    body: "Every income line, every expense, every quarterly safe harbor — folded into a federal + state forecast that updates the moment your bank syncs.",
    pull: "Stop guessing. Stop overpaying.",
  },
  {
    kicker: "Auto-Triage",
    title: "Your bank already knows your deductions.",
    body: "Plaid keeps your accounts in sync hourly. Each transaction lands with a deduction category pre-suggested. One tap to categorize, dismiss, or split.",
    pull: "From pending to filed in seconds.",
  },
  {
    kicker: "Bella · AI Tax Guide",
    title: "The tax answer you wanted, in plain English.",
    body: "Powered by Claude. Ask 'is this trip deductible?' and get the answer plus the IRS publication number plus the memo line phrasing that survives an audit.",
    pull: "Cited. Calm. Always there.",
  },
  {
    kicker: "Never Owe a Penalty",
    title: "Quarterly set-asides on autopilot.",
    body: "Calculated from your live forecast. Reminders fire two weeks early. Goal trackers show how close you are to the safe harbor — before the IRS notices.",
    pull: "April becomes a non-event.",
  },
];

const ENTERPRISE: Capability[] = [
  {
    kicker: "Multi-Client Console",
    title: "Stop running fifty spreadsheets in fifty tabs.",
    body: "Multi-company, multi-engagement. See who's filed, who's behind, who's drifting toward an extension — all at hq.taxottic.com in one calm view.",
    pull: "The whole book of business at a glance.",
  },
  {
    kicker: "Engagement Workflow",
    title: "From signature to safe-harbor in one thread.",
    body: "Send engagement requests. Auto-followups when clients haven't accepted. Transparency view shows what each client is doing — without an email.",
    pull: "Stop chasing. Start advising.",
  },
  {
    kicker: "Branded Firm Portal",
    title: "White-glove without the white labor.",
    body: "Your logo. Your colors. Your firm's voice on every reminder. Branded subscriptions billed under your name. Clients never see another logo than yours.",
    pull: "It's your firm — not Taxottic's.",
  },
  {
    kicker: "Bulk Operations",
    title: "Move fifty clients in the time it takes for one.",
    body: "Bulk Schedule C export. Firm-wide deduction analytics. Multi-client reminders. Outreach automation. Leverage that turns associates into advisors.",
    pull: "Hours saved per close, every month.",
  },
];

function Capabilities({ audience }: { audience: Audience }) {
  const items = audience === "personal" ? PERSONAL : ENTERPRISE;
  return (
    <section className="max-w-6xl mx-auto px-6 py-20 sm:py-28">
      <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
        What you get
      </div>
      <h2 className="display mt-3 text-3xl sm:text-5xl text-forest-900 max-w-3xl">
        {audience === "personal"
          ? "Built so the tax part of your business stops feeling like the scary part."
          : "Built so your firm operates the way clients already think it does."}
      </h2>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        {items.map((c) => (
          <article
            key={c.kicker}
            className="card card-hover p-7 flex flex-col gap-3"
          >
            <div className="text-[10px] uppercase tracking-[0.22em] text-gold-700">
              {c.kicker}
            </div>
            <h3 className="display text-2xl text-forest-900 leading-snug">
              {c.title}
            </h3>
            <p className="text-sm sm:text-base text-ink-soft leading-relaxed">
              {c.body}
            </p>
            <div className="mt-1 text-sm text-forest-700 italic">{c.pull}</div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Proof band — concrete capability list, dark surface
// ---------------------------------------------------------------------------

function ProofBand() {
  const stats = [
    { kpi: "24", label: "Schedule C deduction categories cited" },
    { kpi: "1 hr", label: "Plaid sync cadence (auto)" },
    { kpi: "Q1-Q4", label: "Quarterly safe-harbor reminders, two weeks early" },
    { kpi: "Face ID", label: "Passkey biometric sign-in on every device" },
  ];
  return (
    <section
      className="relative"
      style={{
        background:
          "linear-gradient(180deg, #0f2d24 0%, #0a201a 100%)",
      }}
    >
      <div className="max-w-6xl mx-auto px-6 py-16 sm:py-20 text-cream">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-300">
          Under the hood
        </div>
        <h2 className="display mt-3 text-3xl sm:text-4xl text-cream max-w-3xl">
          Real plumbing — not a pretty form.
        </h2>
        <div className="mt-10 grid grid-cols-2 sm:grid-cols-4 gap-6">
          {stats.map((s) => (
            <div key={s.label}>
              <div className="display text-3xl sm:text-4xl text-cream gold-shine inline-block">
                {s.kpi}
              </div>
              <div className="mt-2 text-xs sm:text-sm text-cream/70 leading-relaxed">
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// FOMO band — pointed line + supporting texture
// ---------------------------------------------------------------------------

function FomoBand({ audience }: { audience: Audience }) {
  const personal = audience === "personal";
  return (
    <section className="max-w-5xl mx-auto px-6 py-20 sm:py-28">
      <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
        Why people switch
      </div>
      <p className="display mt-4 text-3xl sm:text-5xl text-forest-900 leading-tight">
        {personal ? (
          <>
            The average freelancer overpays by{" "}
            <span className="gold-shine">$4,800 a year</span> because they
            forget what they spent in March.
          </>
        ) : (
          <>
            Firms running on Taxottic close{" "}
            <span className="gold-shine">most monthly books</span> before the
            5th — while their competitors are still chasing receipts on the
            12th.
          </>
        )}
      </p>
      <p className="mt-6 text-base sm:text-lg text-ink-soft max-w-2xl leading-relaxed">
        {personal
          ? "Your bank statements remember every transaction. Taxottic makes them count toward the deductions you've already earned."
          : "Your associates are the most expensive people in your office. Stop spending them on data entry and start spending them on advisory work."}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Final CTA
// ---------------------------------------------------------------------------

function FinalCta({ audience }: { audience: Audience }) {
  const personal = audience === "personal";
  return (
    <section className="max-w-5xl mx-auto px-6 pb-20 sm:pb-28">
      <div className="card p-8 sm:p-12 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="max-w-2xl">
          <h2 className="display text-2xl sm:text-3xl text-forest-900">
            {personal
              ? "Start with the next bank transaction you'd otherwise forget."
              : "Move your first client onto Taxottic in under an hour."}
          </h2>
          <p className="mt-3 text-sm sm:text-base text-ink-soft leading-relaxed">
            {personal
              ? "Connect a bank in 90 seconds. See your live federal + state forecast on the next page. No card. No commitment."
              : "Branded portal stood up in a day. Clients migrate via a magic link — no support tickets, no spreadsheet exports."}
          </p>
        </div>
        <div className="flex flex-wrap gap-3 shrink-0">
          <Link href="/login" className="btn-primary">
            {personal ? "Get started free" : "Book walkthrough"}
          </Link>
          <Link
            href={`/?audience=${personal ? "enterprise" : "personal"}`}
            className="btn-ghost"
            scroll={false}
          >
            {personal ? "I'm a firm" : "I'm an individual"}
          </Link>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

function Footer() {
  return (
    <footer className="border-t border-forest-100">
      <div className="max-w-6xl mx-auto px-6 py-10 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <p className="text-xs text-ink-muted max-w-md leading-relaxed">
          Taxottic provides tax forecasting and educational guidance. It is
          not a substitute for advice from a licensed CPA or tax attorney.
        </p>
        <div className="flex gap-4 text-xs text-ink-muted">
          <Link href="/legal/terms" className="hover:text-forest-700">Terms</Link>
          <Link href="/legal/privacy" className="hover:text-forest-700">Privacy</Link>
          <Link href="/login" className="hover:text-forest-700">Sign in</Link>
        </div>
      </div>
    </footer>
  );
}
