import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { PageHeader } from "@/components/PageHeader";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import {
  MileageMap,
  type MapTrip,
  type MapPlace,
} from "@/components/mileage/MileageMap";
import { TripThumbnail } from "@/components/maps/TripThumbnail";
import { TripEndpoints } from "@/components/mileage/TripEndpoints";
import {
  splitScheduleC,
  type ClassifiableTrip,
} from "@/lib/mileage/schedule-c-totals";

// Business-trips dashboard, the breadcrumb map of every drive
// classified as "business". Same data model as the parent /mileage
// page (mileage_trips + mileage_points), filtered to a single
// classification so the map can zoom-fit to ONLY business routes
// and the stats add up to what actually deducts.
//
// Why a dedicated page: the parent /mileage mixes business with
// personal + unclassified for triage. When the user wants "where
// did I go for work this year", which is the actual narrative
// behind the Schedule C mileage deduction, they need a focused
// view at YTD scale. The two routes share the MileageMap component
// so colour-coding, place markers, and bounds-fitting stay
// consistent.

export const dynamic = "force-dynamic";

type SP = Promise<{ range?: string; trip?: string; page?: string }>;

// How many drives one page of this view renders.
//
// PAYLOAD, AND WHY THIS IS A VISIBLE BOUND RATHER THAN A QUIET ONE
// ----------------------------------------------------------------
// Everything expensive on this page is per-drive: each row emits a Static
// Maps thumbnail URL carrying up to 60 encoded fixes (~1.5 KB of HTML), and
// each drive's breadcrumb is serialised into the RSC flight payload for
// <MileageMap>. Measured on one real account in August 2026: 74 business
// drives YTD produced 995 KB of decoded HTML, the largest response in the
// application, of which 530 KB (52%) was breadcrumb points and 130 KB (13%)
// was thumbnail URLs. Both scale linearly with drives, and the old
// `.limit(1000)` allowed 13x that account before it started dropping drives
// on the floor.
//
// The mileage rule in AGENTS.md is that a fabricated mile is worse than a
// missed one, and that a gap must be surfaced rather than hidden. So this
// bound is deliberately NOT a silent truncation:
//
//   - The three totals (drives, miles, deduction) are computed over EVERY
//     matching drive in the range, by paging the full set server-side. They
//     are the Schedule C numbers and they are never a page subtotal.
//   - The list says "Showing 1-100 of N drives" and offers Previous / Next,
//     so every drive stays reachable.
//   - The map caption says it is drawing this page's drives.
//
// This also FIXES a pre-existing quiet truncation: the old `.limit(1000)`
// capped the trip set used to compute totalMiles and totalDeduction, so an
// account with more than 1000 business drives in the range was shown an
// understated mileage deduction with nothing on screen saying so.
const PAGE_SIZE = 100;

// PostgREST caps any single response at 1000 rows, so both the totals sweep
// and the polyline fetch page in 1000-row chunks.
const DB_PAGE = 1000;

// Vertices per drive requested from mileage_trip_polylines.
//
// The overview map is a 520 px dial fitted to a whole year of driving, so a
// drive occupies a few hundred pixels at most and 250 vertices is far more
// than the line can show. The measured account carried a median of 175 fixes
// per drive into the flight payload, and breadcrumb points were 52% of the
// entire 995 KB response.
//
// 60 is the same budget the row thumbnails have always used
// (lib/maps/static-map.ts). Measured on that account: 13,212 points down to
// 4,473, and 995 KB down to 652 KB.
//
// The single-drive view (?trip=<id>) keeps the full 250, because that is the
// screen where the user is inspecting one route rather than scanning a year.
//
// This thins a DRAWING, never a record. `distance_miles` and
// `deduction_cents` are stored on mileage_trips, computed from the raw track
// by the finalize pass; nothing on this page derives a mile from the polyline
// it draws. The RPC's own sampling always keeps the first and last fix, so a
// thinner trail still reaches the drive's true endpoints. The caption under
// the map says the trail is a sample.
const OVERVIEW_POLY_POINTS = 60;
const SINGLE_TRIP_POLY_POINTS = 250;

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
  const { range = "ytd", trip: tripId, page: pageParam } = await searchParams;
  // Single-trip focus: when the user opens a specific drive from the
  // Expenses mileage line (?trip=<id>), scope the whole page to just
  // that one drive, the map auto-fits to its bounds and the list shows
  // its details. The range filter is dropped in this mode (the trip can
  // predate any preset window). Still scoped to the caller's own drives
  // (driver_user_id) so a guessed id can't surface someone else's trip.
  const singleTrip = typeof tripId === "string" && tripId.length > 0;
  const rangeCfg = RANGES[range] ?? RANGES.ytd;
  const sinceIso = rangeCfg.sinceFn(new Date()).toISOString();
  // Clamped to the real page count once we know it (see the count query).
  let pageNum = Math.max(1, Math.floor(Number(pageParam)) || 1);

  const memberships = await getMyCompanies();
  const company = memberships[0]?.company ?? null;

  type TripRow = {
    id: string;
    started_at: string;
    ended_at: string;
    distance_miles: number;
    classification: "business" | "personal" | "unclassified";
    deduction_cents: number;
    /** NULL on rows written before the confirmation migration. */
    needs_confirmation: boolean | null;
    start_place_id: string | null;
    end_place_id: string | null;
  };
  type Pt = { lat: number; lng: number; captured_at: string };

  let trips: TripRow[] = [];
  let places: MapPlace[] = [];
  // Totals over the WHOLE filtered set, not over the rendered page. These
  // three numbers feed the Schedule C mileage deduction, so they are the one
  // thing on this page that must never be a subtotal of what happens to be
  // on screen.
  let totalCount = 0;
  let totalMiles = 0;
  let totalDeduction = 0;
  // Drives the app classified as business on its own and the driver has
  // not confirmed. Held apart from the headline, never dropped.
  //
  // WHY. On 2026-08-22 two such drives were carrying 33.89 USD inside
  // the "Mileage deduction" stat below, which is labelled in this very
  // file as "the Schedule C numbers". A machine guess a human has not
  // agreed with is not a number to put on a tax return.
  //
  // The alternative was zeroing deduction_cents on the row until the
  // driver confirms. This codebase already settled that argument with
  // itself in 20260817010000_mileage_passenger.sql, which refused to
  // destroy captured mileage because a mis-tap would be unrecoverable
  // and it leaves a silent hole in the record. Excluding at read time
  // corrects the same overstatement, keeps the row intact, and reverses
  // itself the moment the driver taps confirm.
  let pendingCount = 0;
  let pendingMiles = 0;
  let pendingDeduction = 0;
  // Route polylines via the mileage_trip_polylines RPC, NOT an embedded
  // mileage_points(...) join, PostgREST caps embedded arrays at 1000
  // rows, which truncated long drives mid-route. The RPC returns a
  // bounded, evenly-strided sample that reaches each route's true ends.
  const pointsByTrip = new Map<string, Pt[]>();
  if (company) {
    // Single classification filter at the DB layer means we only
    // hydrate the breadcrumbs we'll actually render, important at
    // YTD scale where a heavy-driving business can have thousands
    // of trips.
    const scope = () => {
      const q = admin
        .from("mileage_trips")
        .select(
          "id, started_at, ended_at, distance_miles, classification, deduction_cents, needs_confirmation, start_place_id, end_place_id, notes",
        )
        .eq("company_id", company.id)
        .eq("driver_user_id", user.id)
        .eq("classification", "business");
      return singleTrip ? q.eq("id", tripId) : q.gte("started_at", sinceIso);
    };

    // Pass 1: the tax numbers, over every matching drive.
    //
    // `count: "exact"` gives us N for the "showing X of N" disclosure, and
    // then we sweep the two numeric columns in 1000-row pages so the totals
    // stay whole no matter how many drives the range holds. The rows are two
    // numbers each, so this stays cheap even for a heavy-driving account;
    // the expensive per-drive payload is the breadcrumb and the thumbnail,
    // and neither is fetched here.
    if (!singleTrip) {
      const { count } = await admin
        .from("mileage_trips")
        .select("id", { count: "exact", head: true })
        .eq("company_id", company.id)
        .eq("driver_user_id", user.id)
        .eq("classification", "business")
        .gte("started_at", sinceIso);
      totalCount = count ?? 0;
      // A ?page= past the end would otherwise render the "no business
      // drives" empty state, which reads as "your drives are gone".
      pageNum = Math.min(pageNum, Math.max(1, Math.ceil(totalCount / PAGE_SIZE)));
    }

    if (!singleTrip && totalCount > 0) {
      for (let from = 0; from < totalCount; from += DB_PAGE) {
        const { data: sumRows } = await admin
          .from("mileage_trips")
          .select("distance_miles, deduction_cents, needs_confirmation")
          .eq("company_id", company.id)
          .eq("driver_user_id", user.id)
          .eq("classification", "business")
          .gte("started_at", sinceIso)
          .order("started_at", { ascending: false })
          .range(from, from + DB_PAGE - 1);
        // A drive the app GUESSED was business, and the driver has not
        // agreed with, is not a Schedule C number. The rule lives in
        // lib/mileage/schedule-c-totals.ts so it is testable without a
        // database, a session or a rendered page, and so the same rule
        // serves the paged sweep and the single-drive view below.
        const pageSplit = splitScheduleC(
          (sumRows ?? []) as ClassifiableTrip[],
        );
        totalMiles += pageSplit.settledMiles;
        totalDeduction += pageSplit.settledCents;
        pendingCount += pageSplit.pendingCount;
        pendingMiles += pageSplit.pendingMiles;
        pendingDeduction += pageSplit.pendingCents;
      }
    }

    // Pass 2: the drives this page actually renders.
    const offset = singleTrip ? 0 : (pageNum - 1) * PAGE_SIZE;
    const { data: tripData } = await scope()
      .order("started_at", { ascending: false })
      .range(offset, offset + (singleTrip ? 1 : PAGE_SIZE) - 1);
    trips = (tripData ?? []) as unknown as TripRow[];

    if (singleTrip) {
      // One drive: its own numbers are the totals.
      totalCount = trips.length;
      // Same rule as the sweep above, from the same function, or a
      // single-drive view would show a pending guess as a settled
      // Schedule C figure.
      const split = splitScheduleC(trips);
      totalMiles = split.settledMiles;
      totalDeduction = split.settledCents;
      pendingCount = split.pendingCount;
      pendingMiles = split.pendingMiles;
      pendingDeduction = split.pendingCents;
    }

    if (trips.length > 0) {
      // Paginated: PostgREST truncates any response at max-rows (1000),
      // which silently dropped polylines for all but the first few trips
      // (same fix as app/mileage/page.tsx). Bounded by PAGE_SIZE drives at
      // p_max points each, so the old 60-page ceiling is now unreachable.
      const polyRows: ({ trip_id: string } & Pt)[] = [];
      const pMax = singleTrip
        ? SINGLE_TRIP_POLY_POINTS
        : OVERVIEW_POLY_POINTS;
      // The RPC's stride is integer division, so it returns up to roughly
      // 2 * p_max per drive before thinning starts. Size the ceiling for
      // that rather than for p_max exactly.
      const POLY_MAX = trips.length * pMax * 2;
      for (let from = 0; from < POLY_MAX; from += DB_PAGE) {
        const { data: pageRows } = await admin
          .rpc("mileage_trip_polylines", {
            p_trip_ids: trips.map((t) => t.id),
            p_max: pMax,
          })
          .range(from, from + DB_PAGE - 1);
        const rows = (pageRows ?? []) as ({ trip_id: string } & Pt)[];
        polyRows.push(...rows);
        if (rows.length < DB_PAGE) break;
      }
      for (const r of polyRows) {
        const arr = pointsByTrip.get(r.trip_id);
        if (arr) arr.push({ lat: r.lat, lng: r.lng, captured_at: r.captured_at });
        else
          pointsByTrip.set(r.trip_id, [
            { lat: r.lat, lng: r.lng, captured_at: r.captured_at },
          ]);
      }
    }

    const { data: placeData } = await admin
      .from("mileage_places")
      .select("id, kind, label, lat, lng")
      .eq("company_id", company.id);
    places = (placeData ?? []) as unknown as MapPlace[];
  }

  // Where this page sits in the full set, for the disclosure line and the
  // Previous / Next links.
  const pageCount = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const firstOnPage = totalCount === 0 ? 0 : (pageNum - 1) * PAGE_SIZE + 1;
  const lastOnPage = (pageNum - 1) * PAGE_SIZE + trips.length;
  const isPaged = !singleTrip && totalCount > PAGE_SIZE;
  const pageHref = (p: number) =>
    `/mileage/business?range=${range}${p > 1 ? `&page=${p}` : ""}`;

  // MileageMap takes generic MapTrip[]; every trip we pass is
  // already classification="business" so the map renders one
  // colour. Sorting points by captured_at gives us a true
  // breadcrumb trail (the DB doesn't guarantee insert order).
  const mapTrips: MapTrip[] = trips.map((t) => ({
    id: t.id,
    classification: t.classification,
    approximate: ((t as { notes?: string | null }).notes ?? "").startsWith(
      "Approximate drive",
    ),
    points: (pointsByTrip.get(t.id) ?? [])
      .slice()
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
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-6 sm:py-10">
        <PageHeader
          eyebrow={
            <>
              <Link
                href="/mileage"
                className="underline decoration-dotted hover:text-forest-900"
              >
                Mileage
              </Link>{" "}
              ·{" "}
              {singleTrip ? (
                <>
                  <Link
                    href="/mileage/business"
                    className="underline decoration-dotted hover:text-forest-900"
                  >
                    Business trips
                  </Link>{" "}
                  · One drive
                </>
              ) : (
                "Business trips"
              )}
            </>
          }
          title={
            singleTrip ? "This business drive" : "Where the work took you"
          }
          subtitle={
            singleTrip ? (
              "The drive you opened from Expenses, drawn on the map with its start, route, and end. Its mileage deduction is part of your Schedule C total."
            ) : (
              <>
                Every drive you classified as{" "}
                <span className="font-medium text-forest-800">business</span>,
                drawn as a breadcrumb trail. The totals roll straight into your
                Schedule C mileage deduction.
              </>
            )
          }
        />

        {!company ? (
          <p className="mt-6 text-sm text-ink-soft">
            Join or create a company to start tracking business mileage.
          </p>
        ) : (
          <>
            {/* Range picker, same shape as /mileage's, plus a YTD
                preset because the business view is the one users
                hit for tax-year totals. In single-trip mode the range
                is irrelevant, so we swap it for a "back to all" link. */}
            {singleTrip ? (
              <div className="mt-6">
                <Link
                  href="/mileage/business"
                  className="text-xs px-3 h-8 inline-flex items-center rounded-full border border-forest-200 text-forest-800 hover:border-gold-300"
                >
                  &larr; All business trips
                </Link>
              </div>
            ) : (
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
            )}

            <div className="mt-6 grid sm:grid-cols-3 gap-3">
              {/* Every Stat below counts the WHOLE range, not this page.
                  These are the Schedule C numbers. */}
              <Stat
                label="Business trips"
                value={totalCount.toLocaleString("en-US")}
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

            {/* Held out of the figures above, and said out loud.
                A number that silently excludes drives is the same
                problem as one that silently includes them; the driver
                has to be able to see both and act on the difference. */}
            {pendingCount > 0 && (
              <p className="mt-3 text-sm text-ink-soft">
                {pendingCount === 1
                  ? `1 drive is waiting for you to confirm it was business, worth ${fmtMiles(pendingMiles)} miles and ${fmtUsd(pendingDeduction)}.`
                  : `${pendingCount.toLocaleString("en-US")} drives are waiting for you to confirm they were business, worth ${fmtMiles(pendingMiles)} miles and ${fmtUsd(pendingDeduction)} together.`}{" "}
                They are not counted above until you confirm them.
              </p>
            )}

            <div className="mt-6">
              {/* MileageMap auto-fits bounds to whatever trips it
                  receives, so passing the filtered business set
                  gives us a focused "where I went for work" view.
                  Taller than /mileage's default since the
                  breadcrumb is the whole story here. */}
              <MileageMap trips={mapTrips} places={places} height={520} />
              {/* Say plainly what the map is and is not. The trail is a
                  sample of each drive's fixes; the miles and the deduction
                  come from the recorded drive, never from the drawn line. */}
              {!singleTrip && trips.length > 0 && (
                <p className="mt-2 text-xs text-ink-muted leading-relaxed">
                  {isPaged ? (
                    <>
                      The map draws the {trips.length.toLocaleString("en-US")} drives
                      on this page, out of {totalCount.toLocaleString("en-US")} in{" "}
                      {rangeCfg.label.toLowerCase()}. The totals above cover
                      all {totalCount.toLocaleString("en-US")}.{" "}
                    </>
                  ) : null}
                  Each trail is drawn from an evenly spaced sample of the
                  drive&apos;s GPS fixes, start and end always included, so a
                  whole range fits one map. Miles and deduction come from the
                  recorded drive, not from the drawn line. Open a drive from
                  its expense line to see the route at full resolution.
                </p>
              )}
            </div>

            <h2 className="display text-xl text-forest-900 mt-8">
              Trips
              <span className="ml-2 text-sm text-ink-muted">
                {isPaged
                  ? `Showing ${firstOnPage.toLocaleString("en-US")}-${lastOnPage.toLocaleString("en-US")} of ${totalCount.toLocaleString("en-US")} drives`
                  : `${trips.length} ${trips.length === 1 ? "drive" : "drives"}`}
              </span>
            </h2>
            {trips.length === 0 ? (
              <div className="card mt-3 p-6 text-center">
                {singleTrip ? (
                  <>
                    <p className="text-sm text-ink-soft">
                      That drive couldn&apos;t be found.
                    </p>
                    <p className="mt-2 text-xs text-ink-muted max-w-md mx-auto leading-relaxed">
                      It may have been deleted or re-classified since you
                      logged the expense.{" "}
                      <Link
                        href="/mileage/business"
                        className="text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2"
                      >
                        See all business trips
                      </Link>
                      .
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-ink-soft">
                      No business drives in {rangeCfg.label.toLowerCase()}.
                    </p>
                    <p className="mt-2 text-xs text-ink-muted max-w-md mx-auto leading-relaxed">
                      When the phone logs a trip and you mark it{" "}
                      <span className="text-forest-800 font-medium">
                        business
                      </span>
                      , the breadcrumb shows up here. Pop over to{" "}
                      <Link
                        href="/mileage"
                        className="text-gold-800 hover:text-gold-900 font-medium underline underline-offset-2"
                      >
                        Mileage
                      </Link>{" "}
                      to triage any drives waiting for review.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <ul className="mt-3 grid gap-2">
                {trips.map((t) => {
                  const start = placeLabel(t.start_place_id);
                  const end = placeLabel(t.end_place_id);
                  const pts = (pointsByTrip.get(t.id) ?? [])
                    .slice()
                    .sort((a, b) =>
                      a.captured_at < b.captured_at ? -1 : 1,
                    );
                  const startPt = pts[0];
                  const endPt = pts[pts.length - 1];
                  return (
                    <li
                      key={t.id}
                      className="card p-4 grid sm:grid-cols-[auto_1fr_auto] gap-3 items-center"
                    >
                      <TripThumbnail
                        points={(pointsByTrip.get(t.id) ?? [])
                          .slice()
                          .sort((a, b) =>
                            a.captured_at < b.captured_at ? -1 : 1,
                          )
                          .map((p) => ({ lat: p.lat, lng: p.lng }))}
                        classification="business"
                      />
                      <div className="min-w-0">
                        {startPt && endPt ? (
                          <TripEndpoints
                            startLat={startPt.lat}
                            startLng={startPt.lng}
                            endLat={endPt.lat}
                            endLng={endPt.lng}
                            savedStart={start}
                            savedEnd={end}
                          />
                        ) : (
                          <div className="text-sm text-forest-900 truncate">
                            {fmtMiles(Number(t.distance_miles))} mi drive
                          </div>
                        )}
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
                        <div className="text-xs text-rose-700 tabular-nums">
                          {fmtUsd(Number(t.deduction_cents))}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Pager. Every drive in the range stays reachable: this view
                bounds what one response carries, it never drops a drive. */}
            {isPaged && (
              <nav
                aria-label="Business drives pages"
                className="mt-4 flex items-center justify-between gap-3"
              >
                {pageNum > 1 ? (
                  <Link
                    href={pageHref(pageNum - 1)}
                    className="text-xs px-3 h-8 inline-flex items-center rounded-full border border-forest-200 text-forest-800 hover:border-gold-300"
                  >
                    &larr; Newer drives
                  </Link>
                ) : (
                  <span />
                )}
                <span className="text-xs text-ink-muted tabular-nums">
                  Page {pageNum.toLocaleString("en-US")} of{" "}
                  {pageCount.toLocaleString("en-US")}
                </span>
                {pageNum < pageCount ? (
                  <Link
                    href={pageHref(pageNum + 1)}
                    className="text-xs px-3 h-8 inline-flex items-center rounded-full border border-forest-200 text-forest-800 hover:border-gold-300"
                  >
                    Older drives &rarr;
                  </Link>
                ) : (
                  <span />
                )}
              </nav>
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
