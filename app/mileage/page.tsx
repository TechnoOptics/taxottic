import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import { MileageMap, type MapTrip, type MapPlace } from "@/components/mileage/MileageMap";
import { AutoTrackToggle } from "@/components/mileage/AutoTrackToggle";
import { TrackerStatus } from "@/components/mileage/TrackerStatus";
import { TripList, type TripRow } from "@/components/mileage/TripList";
import { ManualLogTrip } from "@/components/mileage/ManualLogTrip";
import { reclassifyTrip, deleteTrip, addManualTrip } from "./actions";

// TripThumbnail is no longer imported at this layer — the new
// TripList client component imports it directly per-row.

// Employee mileage dashboard. Their own driving trails for a
// chosen window, colour-coded business/personal, with the IRS
// deduction running total + one-tap re-classify. Reads via the
// service-role client scoped to driver_user_id = the validated
// user (the codebase's reliable server pattern; RLS still guards
// the API + the firm view).

export const dynamic = "force-dynamic";

type SP = Promise<{ range?: string }>;

const RANGES: Record<string, { label: string; days: number }> = {
  day: { label: "Today", days: 1 },
  week: { label: "This week", days: 7 },
  month: { label: "This month", days: 31 },
  quarter: { label: "Quarter", days: 92 },
};

function fmtMiles(m: number) {
  return m.toLocaleString("en-US", { maximumFractionDigits: 1 });
}
function fmtUsd(cents: number) {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

export default async function MileagePage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const { user, admin } = await requireUserWithAdmin();
  const { range = "week" } = await searchParams;
  const rangeCfg = RANGES[range] ?? RANGES.week;
  const sinceIso = new Date(
    new Date().getTime() - rangeCfg.days * 86_400_000,
  ).toISOString();

  const memberships = await getMyCompanies();
  const company = memberships[0]?.company ?? null;

  type ServerTripRow = {
    id: string;
    started_at: string;
    ended_at: string;
    distance_miles: number;
    classification: "business" | "personal" | "unclassified";
    tax_year: number;
    deduction_cents: number;
    mileage_points: { lat: number; lng: number; captured_at: string }[];
  };

  let trips: ServerTripRow[] = [];
  let places: MapPlace[] = [];
  let lastPointISO: string | null = null;
  let lastTripISO: string | null = null;
  if (company) {
    const { data: tripData } = await admin
      .from("mileage_trips")
      .select(
        "id, started_at, ended_at, distance_miles, classification, tax_year, deduction_cents, mileage_points(lat, lng, captured_at)",
      )
      .eq("company_id", company.id)
      .eq("driver_user_id", user.id)
      .gte("started_at", sinceIso)
      .order("started_at", { ascending: false })
      .limit(500);
    trips = (tripData ?? []) as unknown as ServerTripRow[];

    const { data: placeData } = await admin
      .from("mileage_places")
      .select("id, kind, label, lat, lng")
      .eq("company_id", company.id);
    places = (placeData ?? []) as unknown as MapPlace[];

    // Tracker-status diagnostic — most recent GPS point ingested by
    // THIS user, across any company they belong to. mileage_points
    // doesn't have driver_user_id; join through the trip. Using a
    // single 1-row fetch so the page render cost is constant
    // regardless of how many points exist.
    const { data: lastPoint } = await admin
      .from("mileage_points")
      .select("captured_at, trip:mileage_trips!inner(driver_user_id)")
      .eq("trip.driver_user_id", user.id)
      .order("captured_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lastPointISO =
      (lastPoint as { captured_at?: string } | null)?.captured_at ?? null;

    const { data: lastTrip } = await admin
      .from("mileage_trips")
      .select("started_at")
      .eq("driver_user_id", user.id)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    lastTripISO =
      (lastTrip as { started_at?: string } | null)?.started_at ?? null;
  }

  const businessMiles = trips
    .filter((t) => t.classification === "business")
    .reduce((a, t) => a + Number(t.distance_miles), 0);
  const deductionCents = trips
    .filter((t) => t.classification === "business")
    .reduce((a, t) => a + Number(t.deduction_cents), 0);
  const unclassifiedCount = trips.filter(
    (t) => t.classification === "unclassified",
  ).length;

  const mapTrips: MapTrip[] = trips.map((t) => ({
    id: t.id,
    classification: t.classification,
    points: [...t.mileage_points]
      .sort((a, b) => a.captured_at.localeCompare(b.captured_at))
      .map((p) => ({ lat: p.lat, lng: p.lng })),
  }));

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/dashboard"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Dashboard
          </Link>{" "}
          · Mileage
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Drive log &amp; mileage deduction
        </h1>
        {!company ? (
          <p className="mt-4 text-sm text-ink-soft">
            Join or create a company to start tracking business
            mileage.
          </p>
        ) : (
          <>
            <div className="mt-2 text-sm text-ink-soft">
              {company.name} · {rangeCfg.label.toLowerCase()}
            </div>

            <div className="mt-4">
              <AutoTrackToggle companyId={company.id} />
            </div>

            {/* "Is the tracker actually running?" — the diagnostic
                strip the user asked for after their first real
                drive-day produced zero GPS points. Green when active,
                red with a checklist + manual-log pointer when not. */}
            <TrackerStatus
              lastPointISO={lastPointISO}
              lastTripISO={lastTripISO}
            />

            {/* Pending-classification banner. Mirrors the watch's
                Confirm tab for users without a watch. Big amber CTA
                links to the phone-side swipe deck at
                /mileage/classify. Hidden when nothing is pending. */}
            {unclassifiedCount > 0 ? (
              <Link
                href="/mileage/classify"
                className="mt-4 block rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 hover:border-amber-400"
              >
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="grid place-items-center size-9 rounded-full bg-amber-500 text-white text-lg"
                  >
                    ⚡
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="display text-sm text-amber-900">
                      {unclassifiedCount === 1
                        ? "1 drive needs a quick call"
                        : `${unclassifiedCount} drives need a quick call`}
                    </div>
                    <div className="text-xs text-amber-800 mt-0.5">
                      Tap to swipe business / personal →
                    </div>
                  </div>
                  <span
                    aria-hidden="true"
                    className="text-amber-900 text-sm"
                  >
                    →
                  </span>
                </div>
              </Link>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-2">
              {Object.entries(RANGES).map(([k, v]) => (
                <Link
                  key={k}
                  href={`/mileage?range=${k}`}
                  className={
                    "text-xs px-3 h-8 inline-flex items-center rounded-full border " +
                    (k === range
                      ? "bg-forest-900 text-cream border-forest-900"
                      : "border-forest-200 text-forest-800 hover:border-gold-300")
                  }
                >
                  {v.label}
                </Link>
              ))}
              {/* Cross-link to the dedicated business-trips
                  breadcrumb dashboard. Keep this here even when
                  there are zero business trips so a returning
                  driver can land on the YTD view in one tap. */}
              <Link
                href="/mileage/business?range=ytd"
                className="ml-1 text-xs px-3 h-8 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 text-emerald-800 hover:border-emerald-400"
              >
                <span
                  aria-hidden="true"
                  className="size-1.5 rounded-full bg-emerald-500"
                />
                Business breadcrumbs →
              </Link>
              {/* New (May 2026): saved places. Adding a "work" place
                  here means every future trip that touches it
                  auto-classifies as business — the auto-deduct hook
                  the user asked for. Surface it next to the
                  breadcrumb link so the discovery path is obvious. */}
              <Link
                href="/mileage/places"
                className="text-xs px-3 h-8 inline-flex items-center gap-1.5 rounded-full border border-gold-200 bg-gold-50 text-gold-900 hover:border-gold-400"
              >
                <span aria-hidden="true">📍</span>
                Saved places →
              </Link>
              {/* New (May 2026): per-user schedule. Lets the driver
                  configure which days + hours auto-tracking is
                  allowed to run (always / weekdays / custom). The
                  toggle on this page still has the kill switch; the
                  schedule just bounds when auto-resume kicks in. */}
              <Link
                href="/mileage/schedule"
                className="text-xs px-3 h-8 inline-flex items-center gap-1.5 rounded-full border border-gold-200 bg-gold-50 text-gold-900 hover:border-gold-400"
              >
                <span aria-hidden="true">⏰</span>
                Schedule →
              </Link>
            </div>

            <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Stat
                label="Business miles"
                value={fmtMiles(businessMiles)}
                tone={businessMiles > 0 ? "good" : "neutral"}
              />
              <Stat
                label="Mileage deduction"
                value={fmtUsd(deductionCents)}
                tone="good"
              />
              {/* Same "needs review" count, but when it's > 0 we wrap
                  it in a Link to the swipe deck so the stat itself is
                  the tap target (mirroring the amber banner above —
                  some users tap the stat instead of the banner). */}
              {unclassifiedCount > 0 ? (
                <Link
                  href="/mileage/classify"
                  className="col-span-2 sm:col-span-1 rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <Stat
                    label="Need review"
                    value={String(unclassifiedCount)}
                    tone="warn"
                    caption="Tap to classify →"
                  />
                </Link>
              ) : (
                <Stat
                  label="Need review"
                  value="0"
                  tone="neutral"
                  caption="All caught up"
                />
              )}
            </div>

            <div className="mt-6">
              <MileageMap trips={mapTrips} places={places} />
            </div>

            <h2 className="display text-xl text-forest-900 mt-8">
              Trips
            </h2>
            {/* Grouped, timezone-aware trip list with segmented
                (mutex) classification + delete. Replaces the old
                "3 independent buttons that looked equally pressable"
                row. Renders client-side so dates use the user's
                local timezone instead of Vercel's UTC. */}
            <TripList
              trips={trips.map<TripRow>((t) => ({
                id: t.id,
                startedAtISO: t.started_at,
                endedAtISO: t.ended_at,
                distanceMiles: Number(t.distance_miles),
                classification: t.classification,
                deductionCents: Number(t.deduction_cents),
                points: t.mileage_points,
              }))}
              reclassify={reclassifyTrip}
              deleteTrip={deleteTrip}
            />

            {/* Manual backfill entry — collapsed by default. The user
                ALWAYS has a way to log a drive even if the tracker
                missed it (the realistic scenario, given GPS background
                capture on Android is best-effort). */}
            <ManualLogTrip action={addManualTrip} />

            <p className="mt-8 text-[11px] text-ink-muted leading-relaxed max-w-2xl">
              Deduction uses the IRS standard mileage rate for the
              trip&apos;s tax year and applies only to trips marked
              business. Standard-mileage and actual-vehicle-expense
              methods are mutually exclusive per vehicle per year —
              confirm your method with your preparer.
            </p>
          </>
        )}
      </section>
    </main>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
  caption,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
  caption?: string;
}) {
  const dot =
    tone === "good"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-400"
        : "bg-gold-400";
  return (
    <article className="card p-4 flex items-center gap-3">
      <span aria-hidden="true" className={"size-2.5 rounded-full " + dot} />
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
          {label}
        </div>
        <div className="display text-2xl text-forest-900 tabular-nums mt-0.5">
          {value}
        </div>
        {caption ? (
          <div className="text-[11px] text-ink-muted mt-0.5">{caption}</div>
        ) : null}
      </div>
    </article>
  );
}
