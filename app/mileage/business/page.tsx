import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import {
  MileageMap,
  type MapTrip,
  type MapPlace,
} from "@/components/mileage/MileageMap";
import { TripThumbnail } from "@/components/maps/TripThumbnail";

// Business-trips dashboard — the breadcrumb map of every drive
// classified as "business". Same data model as the parent /mileage
// page (mileage_trips + mileage_points), filtered to a single
// classification so the map can zoom-fit to ONLY business routes
// and the stats add up to what actually deducts.
//
// Why a dedicated page: the parent /mileage mixes business with
// personal + unclassified for triage. When the user wants "where
// did I go for work this year" — which is the actual narrative
// behind the Schedule C mileage deduction — they need a focused
// view at YTD scale. The two routes share the MileageMap component
// so colour-coding, place markers, and bounds-fitting stay
// consistent.

export const dynamic = "force-dynamic";

type SP = Promise<{ range?: string }>;

const RANGES: Record<
  string,
  { label: string; sinceFn: (now: Date) => Date }
> = {
  week: {
    label: "This week",
    sinceFn: (now) => new Date(now.getTime() - 7 * 86_400_000),
  },
  month: {
    label: "This month",
    sinceFn: (now) => new Date(now.getTime() - 31 * 86_400_000),
  },
  quarter: {
    label: "Quarter",
    sinceFn: (now) => new Date(now.getTime() - 92 * 86_400_000),
  },
  ytd: {
    label: "Year to date",
    sinceFn: (now) => new Date(Date.UTC(now.getUTCFullYear(), 0, 1)),
  },
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

export default async function BusinessTripsPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const { user, admin } = await requireUserWithAdmin();
  const { range = "ytd" } = await searchParams;
  const rangeCfg = RANGES[range] ?? RANGES.ytd;
  const sinceIso = rangeCfg.sinceFn(new Date()).toISOString();

  const memberships = await getMyCompanies();
  const company = memberships[0]?.company ?? null;

  type TripRow = {
    id: string;
    started_at: string;
    ended_at: string;
    distance_miles: number;
    classification: "business" | "personal" | "unclassified";
    deduction_cents: number;
    start_place_id: string | null;
    end_place_id: string | null;
    mileage_points: { lat: number; lng: number; captured_at: string }[];
  };

  let trips: TripRow[] = [];
  let places: MapPlace[] = [];
  if (company) {
    // Single classification filter at the DB layer means we only
    // hydrate the breadcrumbs we'll actually render — important at
    // YTD scale where a heavy-driving business can have thousands
    // of trips.
    const { data: tripData } = await admin
      .from("mileage_trips")
      .select(
        "id, started_at, ended_at, distance_miles, classification, deduction_cents, start_place_id, end_place_id, mileage_points(lat, lng, captured_at)",
      )
      .eq("company_id", company.id)
      .eq("driver_user_id", user.id)
      .eq("classification", "business")
      .gte("started_at", sinceIso)
      .order("started_at", { ascending: false })
      .limit(1000);
    trips = (tripData ?? []) as unknown as TripRow[];

    const { data: placeData } = await admin
      .from("mileage_places")
      .select("id, kind, label, lat, lng")
      .eq("company_id", company.id);
    places = (placeData ?? []) as unknown as MapPlace[];
  }

  const totalMiles = trips.reduce(
    (a, t) => a + Number(t.distance_miles),
    0,
  );
  const totalDeduction = trips.reduce(
    (a, t) => a + Number(t.deduction_cents),
    0,
  );

  // MileageMap takes generic MapTrip[]; every trip we pass is
  // already classification="business" so the map renders one
  // colour. Sorting points by captured_at gives us a true
  // breadcrumb trail (the DB doesn't guarantee insert order).
  const mapTrips: MapTrip[] = trips.map((t) => ({
    id: t.id,
    classification: t.classification,
    points: [...t.mileage_points]
      .sort((a, b) => a.captured_at.localeCompare(b.captured_at))
      .map((p) => ({ lat: p.lat, lng: p.lng })),
  }));

  // Place lookup so each trip-list row can show "Home → Office"
  // instead of bare lat/lng. Places that aren't tied to a trip
  // (the user's other stops) still render on the map as markers.
  const placeById = new Map(places.map((p) => [p.id, p] as const));
  function placeLabel(id: string | null): string | null {
    if (!id) return null;
    const p = placeById.get(id);
    if (!p) return null;
    return p.label ?? defaultLabel(p.kind);
  }

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-5xl xl:max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-6 sm:py-10">
        <div className="text-xs uppercase tracking-[0.2em] text-gold-700">
          <Link
            href="/mileage"
            className="underline decoration-dotted hover:text-forest-900"
          >
            Mileage
          </Link>{" "}
          · Business trips
        </div>
        <h1 className="display mt-2 text-3xl sm:text-4xl text-forest-900 leading-tight">
          Where the work took you
        </h1>
        <p className="mt-2 text-sm text-ink-soft max-w-2xl leading-relaxed">
          Every drive you classified as <span className="font-medium text-forest-800">business</span>,
          drawn as a breadcrumb trail. The totals roll straight into
          your Schedule C mileage deduction.
        </p>

        {!company ? (
          <p className="mt-6 text-sm text-ink-soft">
            Join or create a company to start tracking business mileage.
          </p>
        ) : (
          <>
            {/* Range picker — same shape as /mileage's, plus a YTD
                preset because the business view is the one users
                hit for tax-year totals. */}
            <div className="mt-6 flex flex-wrap gap-2">
              {(Object.entries(RANGES) as [string, (typeof RANGES)[string]][]).map(
                ([k, v]) => (
                  <Link
                    key={k}
                    href={`/mileage/business?range=${k}`}
                    className={
                      "text-xs px-3 h-8 inline-flex items-center rounded-full border " +
                      (k === range
                        ? "bg-forest-900 text-cream border-forest-900"
                        : "border-forest-200 text-forest-800 hover:border-gold-300")
                    }
                  >
                    {v.label}
                  </Link>
                ),
              )}
            </div>

            <div className="mt-6 grid sm:grid-cols-3 gap-3">
              <Stat
                label="Business trips"
                value={trips.length.toLocaleString()}
              />
              <Stat
                label="Business miles"
                value={fmtMiles(totalMiles)}
              />
              <Stat
                label="Mileage deduction"
                value={fmtUsd(totalDeduction)}
                tone="good"
              />
            </div>

            <div className="mt-6">
              {/* MileageMap auto-fits bounds to whatever trips it
                  receives, so passing the filtered business set
                  gives us a focused "where I went for work" view.
                  Taller than /mileage's default since the
                  breadcrumb is the whole story here. */}
              <MileageMap trips={mapTrips} places={places} height={520} />
            </div>

            <h2 className="display text-xl text-forest-900 mt-8">
              Trips
              <span className="ml-2 text-sm text-ink-muted">
                {trips.length} {trips.length === 1 ? "drive" : "drives"}
              </span>
            </h2>
            {trips.length === 0 ? (
              <div className="card mt-3 p-6 text-center">
                <p className="text-sm text-ink-soft">
                  No business drives in {rangeCfg.label.toLowerCase()}.
                </p>
                <p className="mt-2 text-xs text-ink-muted max-w-md mx-auto leading-relaxed">
                  When the phone logs a trip and you mark it{" "}
                  <span className="text-forest-800 font-medium">business</span>,
                  the breadcrumb shows up here. Pop over to{" "}
                  <Link
                    href="/mileage"
                    className="text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2"
                  >
                    Mileage
                  </Link>{" "}
                  to triage any drives waiting for review.
                </p>
              </div>
            ) : (
              <ul className="mt-3 grid gap-2">
                {trips.map((t) => {
                  const start = placeLabel(t.start_place_id);
                  const end = placeLabel(t.end_place_id);
                  return (
                    <li
                      key={t.id}
                      className="card p-4 grid sm:grid-cols-[auto_1fr_auto] gap-3 items-center"
                    >
                      <TripThumbnail
                        points={[...t.mileage_points]
                          .sort((a, b) =>
                            a.captured_at < b.captured_at ? -1 : 1,
                          )
                          .map((p) => ({ lat: p.lat, lng: p.lng }))}
                        classification="business"
                      />
                      <div className="min-w-0">
                        <div className="text-sm text-forest-900 truncate">
                          {start && end ? (
                            <>
                              <span className="font-medium">{start}</span>{" "}
                              <span className="text-ink-muted">→</span>{" "}
                              <span className="font-medium">{end}</span>
                            </>
                          ) : (
                            <span>
                              {fmtMiles(Number(t.distance_miles))} mi drive
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-ink-muted mt-0.5">
                          {new Date(t.started_at).toLocaleDateString(
                            undefined,
                            {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            },
                          )}{" "}
                          ·{" "}
                          {new Date(t.started_at).toLocaleTimeString(
                            undefined,
                            { hour: "numeric", minute: "2-digit" },
                          )}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="display text-sm text-forest-900 tabular-nums">
                          {fmtMiles(Number(t.distance_miles))} mi
                        </div>
                        <div className="text-xs text-emerald-700 tabular-nums">
                          {fmtUsd(Number(t.deduction_cents))}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="mt-6 text-xs text-ink-muted leading-relaxed">
              Deductions use the IRS standard mileage rate for each
              trip&apos;s tax year. Want to re-classify a drive?{" "}
              <Link
                href="/mileage"
                className="text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2"
              >
                Open Mileage
              </Link>
              .
            </p>
          </>
        )}
      </section>
    </main>
  );
}

function defaultLabel(kind: MapPlace["kind"]): string {
  switch (kind) {
    case "home":
      return "Home";
    case "office":
      return "Office";
    case "client":
      return "Client";
    default:
      return "Stop";
  }
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
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
      <div>
        <div className="text-[11px] uppercase tracking-[0.2em] text-gold-700">
          {label}
        </div>
        <div className="display text-2xl text-forest-900 tabular-nums mt-0.5">
          {value}
        </div>
      </div>
    </article>
  );
}
