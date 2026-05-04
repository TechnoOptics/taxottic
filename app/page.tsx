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
      <ProductTour />
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
          {personal ? (
            <>
              Taxottic forecasts your taxes in real time, cross-checks every
              bank transaction against{" "}
              <span className="text-cream font-medium">
                1,025 IRS-aligned deductions
              </span>{" "}
              with their IRC sections cited, and reminds you to set the money
              aside before it&apos;s gone. Built for freelancers, contractors,
              and small businesses.
            </>
          ) : (
            <>
              Multi-client management with transparency into every engagement.
              Branded firm portal, automated outreach, bulk operations,{" "}
              <span className="text-cream font-medium">
                1,025 IRS-cited deductions
              </span>{" "}
              auto-applied to every client&apos;s books — without your
              associates juggling fifty spreadsheet tabs.
            </>
          )}
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
    kicker: "1,025 IRS-Cited Deductions",
    title: "Every bank transaction, cross-checked against the full IRS catalog.",
    body: "Plaid syncs hourly. Each transaction is matched against 1,025 deduction items from IRS Pub 334 / 463 / 535 / 587 / 946 — IRC section cited, source URL one tap away. Auto-applied when confidence is high; queued when it isn't.",
    pull: "Hands off. Audit-ready.",
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
// Product tour — Techno Optics LLC running through the app
// Three alternating rows. Each "mockup" is hand-built HTML in the same
// design language as the real app (cards, gold kickers, forest text,
// Fraunces serif on display) so it reads as a screenshot of the product
// rather than a generic illustration.
// ---------------------------------------------------------------------------

function ProductTour() {
  return (
    <section className="bg-white">
      <div className="max-w-6xl mx-auto px-6 py-20 sm:py-28">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          See it run on Techno Optics
        </div>
        <h2 className="display mt-3 text-3xl sm:text-5xl text-forest-900 max-w-3xl">
          A real software company.{" "}
          <span className="gold-shine">Real automation.</span>
        </h2>
        <p className="mt-4 text-base sm:text-lg text-ink-soft max-w-2xl leading-relaxed">
          Techno Optics LLC connected one bank account on a Tuesday. By
          Friday their Q4 forecast, every deductible expense, and a
          ready-to-file Schedule C were waiting in their dashboard — all
          synced in the background, with no spreadsheet opened.
        </p>

        <div className="mt-14 grid gap-16">
          <Row reverse={false}>
            <BankFeedMockup />
            <Caption
              kicker="Hour 1 — Bank sync"
              title="The bank does the work, hourly."
              body="Plaid syncs every active account every hour. New transactions land already tagged against the full 1,025-item IRS deduction catalog — IRC section cited, source URL one tap away. One tap to apply, dismiss, or split. No data entry."
              tags={["Plaid", "1,025 IRS-cited deductions", "Auto-applied"]}
            />
          </Row>

          <Row reverse={true}>
            <Caption
              kicker="Hour 2 — Live forecast"
              title="The forecast updates the moment a transaction lands."
              body="Federal + state brackets, applied to live YTD income and the deductions Techno Optics just claimed. The number in the corner of every screen changes the second the math changes — no nightly recompute, no manual refresh."
              tags={["Federal + state", "Quarterly safe-harbor", "Updated automatically"]}
            />
            <ForecastMockup />
          </Row>

          <Row reverse={false}>
            <ScheduleCMockup />
            <Caption
              kicker="December — Year-end"
              title="One click. The whole Schedule C."
              body="Every applied transaction lands on its proper Schedule C line. Bella tags the meals 50% rule. Vehicle expenses split between standard mileage and actual. Everything cited to the IRS publication. Hand it to your CPA — or keep it."
              tags={["Schedule C", "IRS-cited", "PDF + CSV"]}
            />
          </Row>
        </div>
      </div>
    </section>
  );
}

function Row({
  reverse = false,
  children,
}: {
  reverse?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        "grid gap-8 lg:gap-12 lg:grid-cols-2 items-center " +
        (reverse ? "lg:[&>*:first-child]:order-2" : "")
      }
    >
      {children}
    </div>
  );
}

function Caption({
  kicker,
  title,
  body,
  tags,
}: {
  kicker: string;
  title: string;
  body: string;
  tags: string[];
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-[0.22em] text-gold-700">
        {kicker}
      </div>
      <h3 className="display mt-3 text-2xl sm:text-3xl text-forest-900 leading-snug">
        {title}
      </h3>
      <p className="mt-4 text-base text-ink-soft leading-relaxed">{body}</p>
      <ul className="mt-5 flex flex-wrap gap-2">
        {tags.map((t) => (
          <li
            key={t}
            className="text-[11px] uppercase tracking-[0.18em] text-forest-700 px-2.5 py-1 rounded-full bg-forest-50 border border-forest-100"
          >
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

// Wrapper that gives every mockup the same "lifted screenshot" frame so
// the product tour reads as a series of real captures rather than ad-hoc
// boxes.
function MockupFrame({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div
        className="absolute -inset-4 -z-10 rounded-[28px] opacity-50 blur-2xl"
        aria-hidden="true"
        style={{
          background:
            "radial-gradient(60% 60% at 50% 40%, rgba(213,187,126,0.25), transparent 70%)",
        }}
      />
      <div className="rounded-2xl border border-forest-100 bg-[var(--color-cream)] shadow-[0_24px_60px_-30px_rgba(15,45,36,0.35)] overflow-hidden">
        {/* Faux app chrome: forest header strip with the company badge */}
        <div
          className="flex items-center justify-between px-4 py-2.5"
          style={{
            background:
              "linear-gradient(180deg, #1a4031 0%, #0f2d24 100%)",
          }}
        >
          <div className="flex items-center gap-2">
            <CompanyMonogram />
            <span className="text-[11px] tracking-[0.2em] uppercase text-cream/80">
              Techno Optics LLC · {label}
            </span>
          </div>
          <span className="text-[10px] uppercase tracking-[0.2em] text-gold-300">
            Live
          </span>
        </div>
        <div className="p-5 sm:p-6">{children}</div>
      </div>
    </div>
  );
}

function CompanyMonogram() {
  // 24x24 "TO" tile in the brand gradient, used as the Techno Optics
  // identity throughout the mockups.
  return (
    <div
      className="size-6 rounded-md flex items-center justify-center text-[10px] font-semibold"
      style={{
        background:
          "linear-gradient(135deg, #1a4031 0%, #0f2d24 100%)",
        color: "#d5bb7e",
        boxShadow: "inset 0 0 0 1px rgba(213,187,126,0.25)",
      }}
    >
      TO
    </div>
  );
}

function BankFeedMockup() {
  const txs = [
    {
      merchant: "Adobe Creative Cloud",
      date: "Nov 12",
      amount: "$89.99",
      category: "Software / subscriptions",
      auto: true,
    },
    {
      merchant: "AWS · S3 + CloudFront",
      date: "Nov 11",
      amount: "$342.50",
      category: "Software / subscriptions",
      auto: true,
    },
    {
      merchant: "Delta Airlines · BOS → SFO",
      date: "Nov 09",
      amount: "$612.40",
      category: "Travel",
      auto: true,
    },
    {
      merchant: "Marriott Boston Seaport",
      date: "Nov 09",
      amount: "$384.00",
      category: "Travel",
      auto: true,
    },
    {
      merchant: "Sweetgreen · with client",
      date: "Nov 08",
      amount: "$24.50",
      category: "Meals (50%)",
      auto: true,
    },
  ];
  return (
    <MockupFrame label="Bank feed">
      <div className="flex items-center justify-between text-[11px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Synced 14 minutes ago · Chase Business
        </span>
        <span>5 new this week</span>
      </div>
      <ul className="mt-4 grid gap-2">
        {txs.map((t, i) => (
          <li
            key={i}
            className="flex items-center justify-between gap-3 rounded-lg bg-white border border-forest-100 px-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm text-forest-900 truncate">
                {t.merchant}
              </div>
              <div className="text-[11px] text-ink-muted mt-0.5 flex items-center gap-2">
                <span>{t.date}</span>
                <span className="text-gold-500">·</span>
                <span className="inline-flex items-center gap-1 text-forest-700">
                  <span className="text-gold-600">↳</span>
                  Bella suggested:{" "}
                  <span className="text-forest-900 font-medium">
                    {t.category}
                  </span>
                </span>
              </div>
            </div>
            <div className="text-sm tabular-nums text-forest-900 shrink-0">
              {t.amount}
            </div>
            <span className="text-[10px] uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5 shrink-0">
              applied
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-4 text-[11px] text-ink-muted">
        Bella sat behind every suggestion. Each line links back to the IRS
        publication that explains why it qualifies.
      </div>
    </MockupFrame>
  );
}

function ForecastMockup() {
  return (
    <MockupFrame label="Forecast · Tax year 2026">
      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-lg bg-white border border-forest-100 p-4">
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
            Federal owed
          </div>
          <div className="display mt-2 text-3xl text-forest-900 tabular-nums">
            $14,820
          </div>
          <div className="mt-1 text-[11px] text-ink-muted">
            ↓ $620 from last sync · Q4 estimated
          </div>
        </div>
        <div className="rounded-lg bg-white border border-forest-100 p-4">
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
            State owed (MA)
          </div>
          <div className="display mt-2 text-3xl text-forest-900 tabular-nums">
            $3,210
          </div>
          <div className="mt-1 text-[11px] text-ink-muted">
            ↓ $135 · synced 2 minutes ago
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-lg bg-white border border-forest-100 p-4">
        <div className="flex items-baseline justify-between">
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
            YTD deductions claimed
          </div>
          <div className="text-[11px] text-ink-muted">
            7 of 8 starter categories
          </div>
        </div>
        <div className="display mt-2 text-2xl text-forest-900 tabular-nums">
          $42,807
        </div>
        <ul className="mt-4 grid gap-2">
          {[
            { label: "Software / subscriptions", amount: "$12,840", w: 100 },
            { label: "Travel", amount: "$8,420", w: 66 },
            { label: "Home office (8829)", amount: "$3,840", w: 30 },
            { label: "Meals (50% applied)", amount: "$1,205", w: 9 },
          ].map((r) => (
            <li
              key={r.label}
              className="flex items-center gap-3 text-[12px]"
            >
              <span className="flex-1 truncate text-forest-900">
                {r.label}
              </span>
              <span
                className="flex-none rounded-full bg-forest-50 overflow-hidden"
                style={{ width: "96px", height: "6px" }}
              >
                <span
                  className="block h-full bg-gold-400"
                  style={{ width: `${r.w}%` }}
                />
              </span>
              <span className="w-16 text-right tabular-nums text-forest-700">
                {r.amount}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-2 text-[11px] text-ink-muted">+ 3 more categories</div>
      </div>

      <div className="mt-4 text-[11px] text-ink-muted flex items-center gap-2">
        <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
        Recalculated automatically — last change 2 minutes ago when AWS
        landed.
      </div>
    </MockupFrame>
  );
}

function ScheduleCMockup() {
  const lines: { line: string; label: string; amount: string }[] = [
    { line: "Line 8", label: "Advertising", amount: "$2,400" },
    { line: "Line 18", label: "Office expense + software", amount: "$11,640" },
    { line: "Line 22", label: "Supplies", amount: "$890" },
    { line: "Line 24a", label: "Travel", amount: "$8,420" },
    { line: "Line 24b", label: "Meals (50% applied)", amount: "$1,205" },
    { line: "Line 25", label: "Utilities (incl. internet)", amount: "$1,860" },
    { line: "Line 27a", label: "Bank fees + continuing ed", amount: "$420" },
    { line: "Line 30", label: "Home office (Form 8829)", amount: "$3,840" },
  ];
  return (
    <MockupFrame label="Year-end · Schedule C export">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
            Tax year 2026 · Auto-assembled
          </div>
          <div className="display text-xl text-forest-900 mt-1">
            Schedule C · Profit or Loss from Business
          </div>
        </div>
        <span className="text-[10px] uppercase tracking-[0.2em] text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-1">
          Ready
        </span>
      </div>

      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-[10px] uppercase tracking-[0.18em] text-ink-muted">
            <th className="text-left font-normal pb-2">Line</th>
            <th className="text-left font-normal pb-2">Category</th>
            <th className="text-right font-normal pb-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.line} className="border-t border-forest-100">
              <td className="py-2 text-forest-700 text-xs tabular-nums w-20">
                {l.line}
              </td>
              <td className="py-2 text-forest-900">{l.label}</td>
              <td className="py-2 text-right text-forest-900 tabular-nums">
                {l.amount}
              </td>
            </tr>
          ))}
          <tr className="border-t-2 border-forest-200">
            <td colSpan={2} className="py-3 text-forest-900 font-medium">
              Total deductions
            </td>
            <td className="py-3 text-right tabular-nums text-forest-900 font-medium">
              $30,675
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mt-4 flex items-center justify-between gap-3">
        <div className="text-[11px] text-ink-muted">
          Built from 287 categorized bank transactions. Every line cites
          its IRS publication.
        </div>
        <div className="flex gap-2 shrink-0">
          <span className="text-[10px] uppercase tracking-[0.18em] text-forest-700 px-2.5 py-1 rounded-full bg-forest-50 border border-forest-100">
            PDF
          </span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-forest-700 px-2.5 py-1 rounded-full bg-forest-50 border border-forest-100">
            CSV
          </span>
        </div>
      </div>
    </MockupFrame>
  );
}

// ---------------------------------------------------------------------------
// Proof band — concrete capability list, dark surface
// ---------------------------------------------------------------------------

function ProofBand() {
  const stats = [
    { kpi: "1,025", label: "IRS-cited deductions, auto-matched against every bank transaction" },
    { kpi: "1 hr", label: "Plaid sync cadence — fully automatic" },
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
