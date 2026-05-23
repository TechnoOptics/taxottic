import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import { MileageMap, type MapTrip, type MapPlace } from "@/components/mileage/MileageMap";
import { AutoTrackToggle } from "@/components/mileage/AutoTrackToggle";
import { TripThumbnail } from "@/components/maps/TripThumbnail";
import { reclassifyTrip } from "./actions";

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

  type TripRow = {
    id: string;
    started_at: string;
    ended_at: string;
    distance_miles: number;
    classification: "business" | "personal" | "unclassified";
    tax_year: number;
    deduction_cents: number;
    mileage_points: { lat: number; lng: number; captured_at: string }[];
  };

  let trips: TripRow[] = [];
  let places: MapPlace[] = [];
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
    trips = (tripData ?? []) as unknown as TripRow[];

    const { data: placeData } = await admin
      .from("mileage_places")
      .select("id, kind, label, lat, lng")
      .eq("company_id", company.id);
    places = (placeData ?? []) as unknown as MapPlace[];
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
      <section className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
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
            {trips.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">
                No drives recorded in this window. The phone logs a
                trip automatically when you drive and then stop for
                5+ minutes.
              </p>
            ) : (
              <ul className="mt-3 grid gap-2">
                {trips.map((t) => (
                  <li
                    key={t.id}
                    className="card p-4 flex flex-col sm:grid sm:grid-cols-[1fr_auto] gap-3 sm:items-center"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <TripThumbnail
                        points={[...t.mileage_points]
                          .sort((a, b) =>
                            a.captured_at < b.captured_at ? -1 : 1,
                          )
                          .map((p) => ({ lat: p.lat, lng: p.lng }))}
                        classification={
                          t.classification === "business" ||
                          t.classification === "personal"
                            ? t.classification
                            : "unclassified"
                        }
                      />
                      <div className="min-w-0">
                        {/* Short date on mobile, long on sm+. The old
                            "5/22/2026, 11:11:25 PM — 11:41:25 PM" form
                            was clipping the buttons off the right edge
                            on phone. */}
                        <div className="text-sm text-forest-900 truncate">
                          <span className="sm:hidden">
                            {new Date(t.started_at).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric" },
                            )}
                            {" · "}
                            {new Date(t.started_at).toLocaleTimeString(
                              undefined,
                              { hour: "numeric", minute: "2-digit" },
                            )}
                          </span>
                          <span className="hidden sm:inline">
                            {new Date(t.started_at).toLocaleString()} —{" "}
                            {new Date(t.ended_at).toLocaleTimeString()}
                          </span>
                        </div>
                        <div className="text-xs text-ink-muted mt-0.5">
                          {fmtMiles(Number(t.distance_miles))} mi ·{" "}
                          {t.classification === "business"
                            ? `${fmtUsd(Number(t.deduction_cents))} deduction`
                            : t.classification}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1.5 sm:justify-end">
                      {(
                        ["business", "personal", "unclassified"] as const
                      ).map((c) => (
                        <form action={reclassifyTrip} key={c} className="flex-1 sm:flex-initial">
                          <input
                            type="hidden"
                            name="trip_id"
                            value={t.id}
                          />
                          <input
                            type="hidden"
                            name="classification"
                            value={c}
                          />
                          <button
                            className={
                              "w-full text-[11px] px-2.5 h-9 sm:h-8 rounded-full border " +
                              (t.classification === c
                                ? "bg-forest-900 text-cream border-forest-900"
                                : "border-forest-200 text-forest-800 hover:border-gold-300")
                            }
                          >
                            {c === "unclassified" ? "review" : c}
                          </button>
                        </form>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            )}

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
