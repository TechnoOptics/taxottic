import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { BoltIcon, EyeIcon, MapIcon, PinIcon } from "@/components/ui/Icons";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import {
  MileageMap,
  type MapTrip,
  type MapPlace,
} from "@/components/mileage/MileageMap";
import { AutoTrackToggle } from "@/components/mileage/AutoTrackToggle";
import { MobileOnly } from "@/components/MobileOnly";
import { TrackerStatus } from "@/components/mileage/TrackerStatus";
import { type TripRow } from "@/components/mileage/TripList";
import { MileageReview } from "@/components/mileage/MileageReview";
import { ManualLogTrip } from "@/components/mileage/ManualLogTrip";
import { CompleteDriveFromStops } from "@/components/mileage/CompleteDriveFromStops";
import { RecoverLostDrives } from "@/components/mileage/RecoverLostDrives";
import { DriverPicker } from "@/components/mileage/DriverPicker";
import {
  ALL_DRIVERS,
  loadScopedTrips,
  resolveTripScope,
  stripForeignPrivateTrips,
} from "@/lib/mileage/team-scope";
import { TeamTrackingHealth } from "@/components/mileage/TeamTrackingHealth";
import { loadTeamTrackingHealth } from "@/lib/mileage/team-health";
import { TrackingHealthBanner } from "@/components/mileage/TrackingHealthBanner";
import {
  assessMileageTrackingHealth,
} from "@/lib/mileage/health";
import { finalizeUserTrips } from "@/lib/mileage/finalize";
import { settleWithinBudget } from "@/lib/mileage/finalize-freshness";
import { FinalizeSettleRefresh } from "@/components/mileage/FinalizeSettleRefresh";
import { partitionLoggedTrips } from "@/lib/mileage/passenger";
import { countRecoverableApproxTrips } from "@/lib/mileage/reconstruct";
import { recoverApproximateTrips } from "./actions";
import {
  reclassifyTrip,
  deleteTrip,
  addManualTrip,
  addRouteTrip,
  moveTripCompany,
} from "./actions";

// TripThumbnail is no longer imported at this layer, the new
// TripList client component imports it directly per-row.

// Employee mileage dashboard. Their own driving trails for a
// chosen window, colour-coded business/personal, with the IRS
// deduction running total + one-tap re-classify. Reads via the
// service-role client scoped to driver_user_id = the validated
// user (the codebase's reliable server pattern; RLS still guards
// the API + the firm view).

export const dynamic = "force-dynamic";

type SP = Promise<{ range?: string; driver?: string }>;

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
  const { range = "day", driver: driverParam = "" } = await searchParams;
  const rangeCfg = RANGES[range] ?? RANGES.week;
  const sinceIso = new Date(
    new Date().getTime() - rangeCfg.days * 86_400_000,
  ).toISOString();

  const memberships = await getMyCompanies();
  const company = memberships[0]?.company ?? null;
  const isManager = memberships[0]?.role === "manager";

  // Freshness: materialize the viewer's own staged points RIGHT NOW,
  // instead of making them wait out the 10-minute finalize cron (the
  // "keep reloading until the newest drive appears" complaint). Time-
  // boxed: if the pool is huge or slow we render with whatever exists,
  // and the cron remains the backstop. finalize is idempotent +
  // overlap-guarded, so racing the cron is safe.
  //
  // Time-boxing used to LOSE the slow runs. Promise.race does not cancel
  // the loser: the budget expired, the page rendered without the drive,
  // finalize landed a second later, and the drive appeared only on the
  // NEXT render. That is why tapping any control seemed to fix it, the tap
  // was rendering the previous load's finalize result. So we now record
  // whether the run was still outstanding and hand that one fact to the
  // client, which waits for that single run and refreshes ONCE. A run that
  // finished inside the budget leaves this false and costs no second
  // render at all.
  let finalizeOutstanding = false;
  if (company) {
    const { finished } = await settleWithinBudget(
      finalizeUserTrips(admin, user.id, company.id, {
        sinceIso: new Date(Date.now() - 7 * 86_400_000).toISOString(),
        // Never sever a drive that is still in progress; and the user
        // is looking at the page, so no push ping for what they see.
        forceClose: false,
        push: false,
      }),
      2_500,
    );
    finalizeOutstanding = !finished;
  }

  // Driver switcher (managers only). A manager can review any teammate's
  // drive log; the trip query + stats + map all re-scope to the chosen
  // driver. Drivers = the company's members (names from profiles). Self
  // is labelled "· you" and is the default. Members that never drove are
  // still listed (picking them just shows an empty log).
  let drivers: { userId: string; label: string }[] = [];
  if (company && isManager) {
    // company_members.user_id has NO foreign key to profiles (it points
    // at auth.users), so PostgREST can't resolve an embedded
    // `profile:profiles(...)` select, it silently returns null (same
    // gotcha documented in manage/page.tsx). Fetch profiles separately.
    const { data: memberRows } = await admin
      .from("company_members")
      .select("user_id, display_name, department:departments(name)")
      .eq("company_id", company.id);
    const memberIds = (memberRows ?? []).map((m) => m.user_id);
    const { data: profileRows } = memberIds.length
      ? await admin.from("profiles").select("id, full_name, email").in("id", memberIds)
      : { data: [] as { id: string; full_name: string | null; email: string | null }[] };
    const profileById = new Map((profileRows ?? []).map((p) => [p.id, p]));
    drivers = (memberRows ?? [])
      .map((m) => {
        const p = profileById.get(m.user_id) ?? null;
        const dept = m.department as unknown as { name: string } | null;
        const name = (
          (m.display_name as string | null)?.trim() ||
          p?.full_name?.trim() ||
          p?.email ||
          "Member"
        ).trim();
        const withDept = dept?.name ? `${name} · ${dept.name}` : name;
        return {
          userId: m.user_id as string,
          label: m.user_id === user.id ? `${withDept} · you` : withDept,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  // Who this request may read. resolveTripScope owns the whole decision
  // (see lib/mileage/team-scope.ts): a manager of a 2+ person team now
  // DEFAULTS to the team overlay, everyone else, and any hand-edited
  // ?driver= naming a stranger, collapses to their own drives.
  const scope = resolveTripScope({
    isManager,
    viewerUserId: user.id,
    driverParam,
    driverIds: drivers.map((d) => d.userId),
  });
  const viewingAll = scope.kind === "team";
  const viewingDriverId =
    scope.kind === "team" ? user.id : scope.driverUserId;
  const viewingSelf = scope.kind === "self";
  const viewingDriverLabel =
    drivers.find((d) => d.userId === viewingDriverId)?.label ?? null;
  const showDriverPicker = isManager && drivers.length >= 2;

  // Team drive-tracking health (manager-only), computed from raw uploads
  // so it is accurate even for a teammate on an old build. Surfaces a
  // driver whose phone went silent or has been parked, the failure that
  // used to go unnoticed until a week of drives had already gone missing.
  const teamHealth =
    isManager && drivers.length >= 1
      ? await loadTeamTrackingHealth(admin, company!.id, drivers, Date.now())
      : [];
  // Driver display names for the map legend + rollup (strip the "· you"
  // / "· Dept" suffixes the picker label carries).
  const driverNameById = new Map(
    drivers.map((d) => [d.userId, d.label.split(" · ")[0]]),
  );

  type ServerTripRow = {
    id: string;
    driver_user_id?: string;
    started_at: string;
    ended_at: string;
    distance_miles: number;
    classification: "business" | "personal" | "unclassified" | "passenger";
    tax_year: number;
    deduction_cents: number;
    needs_confirmation: boolean | null;
  };
  type Pt = { lat: number; lng: number; captured_at: string };

  let trips: ServerTripRow[] = [];
  // Drives the driver marked "I was a passenger". Held back from the log,
  // the map and every total, but NOT dropped: keeping them is what makes
  // the tap reversible (see lib/mileage/passenger.ts).
  let excludedTrips: ServerTripRow[] = [];
  let places: MapPlace[] = [];
  let lastPointISO: string | null = null;
  let lastTripISO: string | null = null;
  // Route polylines, keyed by trip id. Fetched via the
  // mileage_trip_polylines RPC, NOT an embedded mileage_points(...) join:
  // PostgREST caps embedded arrays at 1000 rows, which truncated long
  // drives mid-route (a 35.8 mi drive drew only its first ~19 mi). The
  // RPC returns a bounded, evenly-strided sample that still reaches each
  // route's true start + end.
  const pointsByTrip = new Map<string, Pt[]>();
  if (company) {
    // PRIVACY. Every restriction is applied in the query, server side:
    // your own drives come back whole, anyone else's are narrowed to
    // confirmed business trips. Nothing personal is fetched and then
    // hidden. See lib/mileage/team-scope.ts + team-scope.test.ts; RLS
    // does NOT enforce this, a manager may read every trip in the
    // company, so these filters are the only barrier.
    // The privacy strip feeds the passenger partition DIRECTLY, so no name
    // in scope ever holds the unpartitioned rows for a later edit to
    // render by accident. A teammate's row can never be a passenger one
    // anyway (loadScopedTrips restricts foreign drives to business), so
    // everything held back here is the viewer's own.
    ({ logged: trips, excluded: excludedTrips } = partitionLoggedTrips(
      stripForeignPrivateTrips(
        await loadScopedTrips<ServerTripRow>(admin, {
          companyId: company.id,
          scope,
          sinceIso,
        }),
        user.id,
      ),
    ));

    if (trips.length > 0) {
      // PostgREST truncates ANY response at max-rows (1000). 500 trips x
      // 250 points blows through that, so only the first ~4 trips (in
      // uuid order, effectively random) got polylines back and every
      // other row rendered NO thumbnail. Page through with .range()
      // until a short page.
      const polyRows: ({ trip_id: string } & Pt)[] = [];
      const POLY_PAGE = 1000;
      for (let from = 0; from < 60_000; from += POLY_PAGE) {
        const { data: pageRows } = await admin
          .rpc("mileage_trip_polylines", {
            p_trip_ids: trips.map((t) => t.id),
            p_max: 250,
          })
          .range(from, from + POLY_PAGE - 1);
        const rows = (pageRows ?? []) as ({ trip_id: string } & Pt)[];
        polyRows.push(...rows);
        if (rows.length < POLY_PAGE) break;
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

    // Tracker-status diagnostic, most recent GPS point ingested by
    // THIS user, across any company they belong to. mileage_points
    // doesn't have driver_user_id; join through the trip. Using a
    // single 1-row fetch so the page render cost is constant
    // regardless of how many points exist. Only computed for the
    // self view, "is YOUR tracker running" is meaningless when a
    // manager is reviewing another driver's log (TrackerStatus is
    // hidden in that case).
    if (viewingSelf) {
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

  // Belt-and-braces, in the same spirit as stripForeignPrivateTrips: the
  // partition above already removed every passenger drive, and the map has
  // no colour for one because it must never draw one. Re-stating it here
  // as a real runtime check means a future edit that renders the
  // unpartitioned rows still cannot put an excluded route on the map.
  const drawable = trips.filter(
    (t): t is ServerTripRow & { classification: MapTrip["classification"] } =>
      t.classification !== "passenger",
  );
  const mapTrips: MapTrip[] = drawable.map((t) => ({
    id: t.id,
    classification: t.classification,
    approximate: ((t as { notes?: string | null }).notes ?? "").startsWith(
      "Approximate drive",
    ),
    // Driver identity only in the "all drivers" overlay, so single-driver
    // views keep the business/personal classification colours.
    driverId: viewingAll ? t.driver_user_id ?? null : null,
    driverName: viewingAll
      ? driverNameById.get(t.driver_user_id ?? "") ?? null
      : null,
    points: (pointsByTrip.get(t.id) ?? [])
      .slice()
      .sort((a, b) => a.captured_at.localeCompare(b.captured_at))
      .map((p) => ({ lat: p.lat, lng: p.lng })),
  }));

  // Per-driver rollup for the team overlay (business miles + deduction per
  // teammate), largest deduction first. Empty outside "all drivers" mode.
  const driverRollup = viewingAll
    ? (() => {
        const by = new Map<
          string,
          { miles: number; deduction: number; trips: number }
        >();
        for (const t of trips) {
          const k = t.driver_user_id ?? "";
          const cur = by.get(k) ?? { miles: 0, deduction: 0, trips: 0 };
          cur.trips += 1;
          if (t.classification === "business") {
            cur.miles += Number(t.distance_miles);
            cur.deduction += Number(t.deduction_cents);
          }
          by.set(k, cur);
        }
        return Array.from(by.entries())
          .map(([id, agg]) => ({
            id,
            label: driverNameById.get(id) ?? "Driver",
            ...agg,
          }))
          .sort((a, b) => b.deduction - a.deduction);
      })()
    : [];

  // Tracking-health check (self only, you can't fix another driver's
  // phone). When drives aren't being captured, warn + offer recovery.
  let health: Awaited<ReturnType<typeof assessMileageTrackingHealth>> | null =
    null;
  let recoverable = 0;
  if (company && viewingSelf) {
    health = await assessMileageTrackingHealth(admin, user.id, company.id);
    if (health.status === "degraded") {
      recoverable = await countRecoverableApproxTrips(
        admin,
        user.id,
        company.id,
        new Date(Date.now() - 90 * 86_400_000).toISOString(),
      );
    }
  }

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-6 sm:py-10">
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
            {/* The freshness pass was still running when this render had
                to go out, so the list below may be missing a drive that is
                about to land. Waits for that one run and refreshes once.
                Renders nothing, and is not rendered at all when finalize
                finished inside its budget. */}
            {finalizeOutstanding ? <FinalizeSettleRefresh /> : null}
            <div className="mt-2 text-sm text-ink-soft">
              {company.name} · {rangeCfg.label.toLowerCase()}
            </div>

            {isManager && teamHealth.length > 0 ? (
              <TeamTrackingHealth rows={teamHealth} />
            ) : null}

            {/* Manager-only driver switcher. Re-scopes the whole page to
                a chosen teammate's drives. */}
            {showDriverPicker ? (
              <div className="mt-4">
                <DriverPicker
                  selfUserId={user.id}
                  drivers={drivers}
                  current={viewingAll ? ALL_DRIVERS : viewingDriverId}
                />
              </div>
            ) : null}

            {viewingAll ? (
              <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-forest-200 bg-forest-50 px-4 py-2.5 text-sm text-forest-800">
                <MapIcon className="size-4 shrink-0" />
                <span>
                  Team view: every driver&apos;s trails in their own colour,
                  numbered to match the legend. Teammates show confirmed
                  business drives only, never their personal miles. Your own
                  drives show every classification.
                </span>
                <Link
                  href={`/mileage?range=${range}&driver=${user.id}`}
                  className="underline decoration-dotted whitespace-nowrap hover:text-forest-900"
                >
                  My drive log →
                </Link>
              </div>
            ) : !viewingSelf ? (
              <div className="mt-3 flex items-center gap-2 rounded-xl border border-forest-200 bg-forest-50 px-4 py-2.5 text-sm text-forest-800">
                <EyeIcon className="size-4 shrink-0" />
                <span>
                  Reviewing{" "}
                  <span className="font-medium">
                    {viewingDriverLabel ?? "a teammate"}
                  </span>
                  &apos;s drives. You can re-classify or remove trips; their
                  own tracking controls stay on their device.
                </span>
              </div>
            ) : null}

            {/* Auto-track toggle + tracker diagnostics are self-only -
                you can't flip another driver's phone tracker. */}
            {viewingSelf ? (
              <div className="mt-4">
                <MobileOnly
                  title="Automatic mileage tracking"
                  description="Taxottic uses your phone's GPS to detect drives and log them in the background, this runs only in the Taxottic mobile app. On the web you can still add drives by hand below."
                >
                  <AutoTrackToggle companyId={company.id} />
                </MobileOnly>
              </div>
            ) : null}

            {/* "Is the tracker actually running?", the diagnostic
                strip the user asked for after their first real
                drive-day produced zero GPS points. Green when active,
                red with a checklist + manual-log pointer when not. */}
            {viewingSelf ? (
              <TrackerStatus
                lastPointISO={lastPointISO}
                lastTripISO={lastTripISO}
              />
            ) : null}

            {viewingSelf && health?.status === "degraded" ? (
              <div className="mt-4">
                <TrackingHealthBanner
                  reason={health.reason ?? ""}
                  recoverable={recoverable}
                  recoverAction={recoverApproximateTrips}
                />
              </div>
            ) : null}

            {/* Pending-classification banner. Mirrors the watch's
                Confirm tab for users without a watch. Big amber CTA
                links to the phone-side swipe deck at
                /mileage/classify. Hidden when nothing is pending, and
                when reviewing another driver (that deck is your own).
                Shown in the team view too: a teammate's unclassified drives
                are never fetched, so this count is only ever the viewer's,
                and making the team view the default must not silently cost
                a manager their own triage queue. */}
            {(viewingSelf || viewingAll) && unclassifiedCount > 0 ? (
              <Link
                href="/mileage/classify"
                className="mt-4 block rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 hover:border-amber-400"
              >
                <div className="flex items-center gap-3">
                  <span className="grid place-items-center size-9 shrink-0 rounded-full bg-amber-500 text-white">
                    <BoltIcon className="size-5" />
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
                  // Carry the driver scope across a range change. Without
                  // it, switching range drops ?driver= and, now that no
                  // param means the team view, would throw a manager out
                  // of whichever single log they were reading.
                  href={
                    isManager && driverParam
                      ? `/mileage?range=${k}&driver=${driverParam}`
                      : `/mileage?range=${k}`
                  }
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
                  auto-classifies as business, the auto-deduct hook
                  the user asked for. Surface it next to the
                  breadcrumb link so the discovery path is obvious. */}
              <Link
                href="/mileage/places"
                className="text-xs px-3 h-8 inline-flex items-center gap-1.5 rounded-full border border-gold-200 bg-gold-50 text-gold-900 hover:border-gold-400"
              >
                <PinIcon className="size-3.5 shrink-0" />
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

            {viewingAll ? (
              // Team overlay: a read-only map of everyone's trails (one
              // colour per driver) + a per-driver rollup. Per-trip triage
              // (reclassify / delete) stays on a single driver's log, so
              // the mixed multi-owner overlay never exposes those actions.
              <>
                <div className="mt-4">
                  <MileageMap trips={mapTrips} places={places} height={460} />
                </div>
                {driverRollup.length > 0 ? (
                  <ul className="mt-4 grid gap-2">
                    {driverRollup.map((d) => (
                      <li
                        key={d.id}
                        className="card p-4 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-forest-900 truncate">
                            {d.label}
                          </div>
                          <div className="text-xs text-ink-muted mt-0.5">
                            {d.trips} trip{d.trips === 1 ? "" : "s"} ·{" "}
                            {fmtMiles(d.miles)} business mi
                          </div>
                        </div>
                        <div className="display text-lg text-forest-900 tabular-nums">
                          {fmtUsd(d.deduction)}
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              /* Map + trip list share one client owner so "Review" on a
                 trip focuses that single drive on the map and only ONE
                 trip is ever in review at a time. Default (no focus) is
                 the range overview where all drives plot together. The
                 list is grouped + timezone-aware (local, not Vercel UTC);
                 Business/Personal are exact-match toggles that show
                 nothing selected for an unclassified drive. */
              <MileageReview
                mapTrips={mapTrips}
                places={places}
                tripRows={trips.map<TripRow>((t) => ({
                  id: t.id,
                  startedAtISO: t.started_at,
                  endedAtISO: t.ended_at,
                  distanceMiles: Number(t.distance_miles),
                  classification: t.classification,
                  deductionCents: Number(t.deduction_cents),
                  needsConfirmation: t.needs_confirmation === true,
                  points: pointsByTrip.get(t.id) ?? [],
                  companyId: company.id,
                }))}
                excludedRows={excludedTrips.map((t) => ({
                  id: t.id,
                  startedAtISO: t.started_at,
                  endedAtISO: t.ended_at,
                  distanceMiles: Number(t.distance_miles),
                }))}
                reclassify={reclassifyTrip}
                deleteTrip={deleteTrip}
                companies={memberships.map((m) => ({
                  id: m.company.id,
                  name: m.company.name,
                }))}
                moveTripCompany={moveTripCompany}
              />
            )}

            {/* Stat tiles moved below the map/trip list (May 2026), the
                user asked for the map and logged drives to be the first
                thing visible on this page, not stats. Kept compact under
                a small "Details" label rather than the full-size cards
                that used to sit above the fold. */}
            <div className="mt-6">
              <div className="text-[10px] uppercase tracking-[0.28em] text-gold-700 font-medium">
                Details
              </div>
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2">
                <Stat
                  compact
                  label="Business miles"
                  value={fmtMiles(businessMiles)}
                  tone={businessMiles > 0 ? "good" : "neutral"}
                />
                <Stat
                  compact
                  label="Mileage deduction"
                  value={fmtUsd(deductionCents)}
                  tone="good"
                />
                {/* Same "needs review" count, but when it's > 0 we wrap
                    it in a Link to the swipe deck so the stat itself is
                    the tap target (mirroring the amber banner above -
                    some users tap the stat instead of the banner). */}
                {(viewingSelf || viewingAll) && unclassifiedCount > 0 ? (
                  <Link
                    href="/mileage/classify"
                    className="col-span-2 sm:col-span-1 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  >
                    <Stat
                      compact
                      label="Need review"
                      value={String(unclassifiedCount)}
                      tone="warn"
                      caption="Tap to classify →"
                    />
                  </Link>
                ) : (
                  <Stat
                    compact
                    label="Need review"
                    value={String(unclassifiedCount)}
                    tone={unclassifiedCount > 0 ? "warn" : "neutral"}
                    caption={
                      unclassifiedCount > 0 ? "Unclassified" : "All caught up"
                    }
                  />
                )}
              </div>
            </div>

            {/* Manual backfill entry, collapsed by default. The user
                ALWAYS has a way to log a drive even if the tracker
                missed it (the realistic scenario, given GPS background
                capture on Android is best-effort). Self-only: a manual
                trip is always logged under the current user, so it's
                hidden when reviewing another driver. */}
            {viewingSelf ? <ManualLogTrip action={addManualTrip} /> : null}
            {/* Route reconstruction, the "phone died mid-drive" recovery.
                Enter the stops; we compute the driving distance. */}
            {viewingSelf ? (
              <CompleteDriveFromStops action={addRouteTrip} />
            ) : null}
            {/* "My app closed on the drive back and the drive never
                showed." Sweeps 45 days of staged points, closes drives
                the phone left open, and reports what it could NOT turn
                into a drive rather than reporting silence. Self-only:
                the sweep runs against the caller's own staging pool. */}
            {viewingSelf ? <RecoverLostDrives /> : null}

            <p className="mt-8 text-[11px] text-ink-muted leading-relaxed max-w-2xl">
              Deduction uses the IRS standard mileage rate for the
              trip&apos;s tax year and applies only to trips marked
              business. Standard-mileage and actual-vehicle-expense
              methods are mutually exclusive per vehicle per year -
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
  compact = false,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "warn";
  caption?: string;
  compact?: boolean;
}) {
  const dot =
    tone === "good"
      ? "bg-emerald-500"
      : tone === "warn"
        ? "bg-amber-400"
        : "bg-gold-400";
  return (
    <article
      className={
        "card flex items-center gap-3 " + (compact ? "p-3" : "p-4")
      }
    >
      <span aria-hidden="true" className={"size-2.5 rounded-full " + dot} />
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.2em] text-gold-700">
          {label}
        </div>
        <div
          className={
            "display text-forest-900 tabular-nums mt-0.5 " +
            (compact ? "text-lg" : "text-2xl")
          }
        >
          {value}
        </div>
        {caption ? (
          <div className="text-[11px] text-ink-muted mt-0.5">{caption}</div>
        ) : null}
      </div>
    </article>
  );
}
