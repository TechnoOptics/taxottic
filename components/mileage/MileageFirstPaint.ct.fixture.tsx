import { TeamTrackingHealth } from "./TeamTrackingHealth";
import { TeamViewNote } from "./TeamViewNote";
import { DriverPicker } from "./DriverPicker";
import { NeedsDecisionPill } from "./NeedsDecisionPill";

// Mount fixture for MileageFirstPaint.ct.spec.tsx. Lives in its own file
// because Playwright CT can only mount components it imports; one defined
// inside the spec "cannot be mounted".

const SELF = "u-self";
const DRIVERS = [
  { userId: SELF, label: "Abel · you" },
  { userId: "u-2", label: "Grace Hopper · Field" },
  { userId: "u-3", label: "Marcus Aurelius · Field" },
];

// One teammate silent for 42h, the other two healthy: the exact state in
// the report. The alert only renders when someone needs attention, so
// this is the case that costs height.
const HEALTH = [
  { userId: SELF, label: "Abel · you", health: { status: "healthy" as const, ageMs: 5 * 60_000 } },
  { userId: "u-2", label: "Grace Hopper · Field", health: { status: "silent" as const, ageMs: 42 * 3_600_000 } },
  { userId: "u-3", label: "Marcus Aurelius · Field", health: { status: "healthy" as const, ageMs: 20 * 60_000 } },
];

const RANGES: Record<string, string> = {
  day: "Today",
  week: "This week",
  month: "This month",
  quarter: "Quarter",
};

/**
 * The head of /mileage as a manager of a three-person team sees it, in
 * the same order and with the same wrappers app/mileage/page.tsx renders.
 *
 * The real components carry the parts this test exists to measure. The
 * chrome around them (breadcrumb, title, company line, the review CTA
 * card, the range pills) is mirrored from the page because the page is
 * an async server component behind auth and cannot mount here. A drift
 * in the mirrored chrome would make this measurement inexact; it cannot
 * hide a regression in the components under test.
 */
export function ManagerPageHead() {
  return (
    <main id="main" className="min-h-screen">
      {/* AppHeader is fixed and leaves this spacer in flow (AppHeader.tsx). */}
      <div aria-hidden="true" style={{ height: "3.25rem" }} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <a href="/dashboard" className="underline decoration-dotted">Dashboard</a> · Mileage
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Drive log &amp; mileage deduction
        </h1>
        <div className="mt-2 text-sm text-ink-soft">Techno Optics LLC · today</div>

        <TeamTrackingHealth rows={HEALTH} />

        <div className="mt-4">
          <DriverPicker selfUserId={SELF} drivers={DRIVERS} current="all" />
        </div>

        <TeamViewNote range="day" selfUserId={SELF} />

        {/* The review CTA card, present whenever the viewer has drives
            waiting. The reporter's screen had it. */}
        <a
          href="/mileage/classify"
          data-ct="cta"
          className="mt-4 block rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <span className="grid place-items-center size-9 shrink-0 rounded-full bg-amber-500 text-white" />
            <div className="min-w-0 flex-1">
              <div className="display text-sm text-amber-900">3 drives need a quick call</div>
              <div className="text-xs text-amber-800 mt-0.5">Tap to confirm business or personal →</div>
            </div>
            <span aria-hidden="true" className="text-amber-900 text-sm">→</span>
          </div>
        </a>

        <div data-ct="controls" className="mt-4 flex flex-wrap items-center gap-2">
          <NeedsDecisionPill count={3} />
          <span aria-hidden="true" className="hidden sm:block h-5 w-px bg-forest-200" />
          {Object.entries(RANGES).map(([k, label]) => (
            <a
              key={k}
              href={`/mileage?range=${k}`}
              className={
                "text-xs px-3 h-8 inline-flex items-center rounded-full border " +
                (k === "day"
                  ? "bg-forest-900 text-cream border-forest-900"
                  : "border-forest-200 text-forest-800")
              }
            >
              {label}
            </a>
          ))}
          <a
            href="/mileage/business?range=ytd"
            className="ml-1 text-xs px-3 h-8 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800"
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-emerald-500" />
            Business breadcrumbs →
          </a>
          <a
            href="/mileage/places"
            className="text-xs px-3 h-8 inline-flex items-center gap-1.5 rounded-full border border-gold-200 bg-gold-50 text-gold-900"
          >
            Saved places →
          </a>
          <a
            href="/mileage/schedule"
            className="text-xs px-3 h-8 inline-flex items-center gap-1.5 rounded-full border border-gold-200 bg-gold-50 text-gold-900"
          >
            Schedule →
          </a>
        </div>

        {/* MileageMap is a Leaflet client component; only its top edge
            matters here, and the page gives it height={460}. */}
        <div data-ct="map" className="mt-4 rounded-2xl bg-forest-100" style={{ height: 460 }} />
      </section>
    </main>
  );
}
