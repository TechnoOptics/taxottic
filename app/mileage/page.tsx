import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { WarningIcon } from "@/components/ui/Icons";
import { requireUserWithAdmin, getMyCompanies } from "@/lib/auth";
import {
  MileageMapRoutes,
  type MapTrip,
  type MapPlace,
  type RoutelessTrip,
} from "@/components/mileage/MileageMap";
import { AutoTrackToggle } from "@/components/mileage/AutoTrackToggle";
import { MobileOnly } from "@/components/MobileOnly";
import { TrackerStatus } from "@/components/mileage/TrackerStatus";
import { DriveLog } from "@/components/mileage/DriveLog";
import type { SentDrive } from "@/app/api/mileage/drives/route";
import { ManualLogTrip } from "@/components/mileage/ManualLogTrip";
import { CompleteDriveFromStops } from "@/components/mileage/CompleteDriveFromStops";
import { RecoverLostDrives } from "@/components/mileage/RecoverLostDrives";
import { splitScheduleC } from "@/lib/mileage/schedule-c-totals";
import { DriverPicker } from "@/components/mileage/DriverPicker";
import {
  ALL_DRIVERS,
  resolveTripScope,
  stripForeignPrivateTrips,
} from "@/lib/mileage/team-scope";
import { loadDrivePage } from "@/lib/mileage/drive-page";
import { indexPlaces, tripPlaces } from "@/lib/mileage/place-names";
import {
  TeamTrackingHealth,
  driversNeedingAttention,
} from "@/components/mileage/TeamTrackingHealth";
import { TeamViewNote } from "@/components/mileage/TeamViewNote";
import { loadTeamTrackingHealth } from "@/lib/mileage/team-health";
import { describeDeviceCause, evaluateDeviceCause } from "@/lib/mileage/device-cause";
import { TrackingHealthBanner } from "@/components/mileage/TrackingHealthBanner";
import {
  assessMileageTrackingHealth,
} from "@/lib/mileage/health";
import { finalizeUserTrips } from "@/lib/mileage/finalize";
import {
  RENDER_FRESHNESS_WINDOW_MS,
  settleWithinBudget,
} from "@/lib/mileage/finalize-freshness";
import { FinalizeSettleRefresh } from "@/components/mileage/FinalizeSettleRefresh";
import { MileageAutoRefresh } from "@/components/mileage/MileageAutoRefresh";
import { MilesHead } from "@/components/mileage/MilesHead";
import { countDrivesAwaitingDecision } from "@/lib/mileage/awaiting-decision";
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

type SP = Promise<{ driver?: string }>;

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
  const { driver: driverParam = "" } = await searchParams;

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
  //
  // The WINDOW is what makes that budget affordable. It used to be 7
  // days, which made finalize page ~6,700 rows of permanently-unconsumed
  // staging residue out of PostgREST on every single load (7 sequential
  // HTTP round trips, 1.1-1.5s measured) and create nothing, because the
  // cron and the ingest path had already processed all of it. See
  // RENDER_FRESHNESS_WINDOW_MS for why hours is the right order of
  // magnitude here and which paths cover the rest.
  let finalizeOutstanding = false;
  if (company) {
    const { finished } = await settleWithinBudget(
      finalizeUserTrips(admin, user.id, company.id, {
        sinceIso: new Date(
          Date.now() - RENDER_FRESHNESS_WINDOW_MS,
        ).toISOString(),
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
    /** The saved place each end matched, if any. mileage_trips has no
     *  lat/lng of its own, so these two uuids are the only way a row can
     *  name where it went before its polyline arrives. */
    start_place_id?: string | null;
    end_place_id?: string | null;
  };

  let trips: ServerTripRow[] = [];
  // Drives the driver marked "I was a passenger". Held back from the log,
  // the map and every total, but NOT dropped: keeping them is what makes
  // the tap reversible (see lib/mileage/passenger.ts).
  let excludedTrips: ServerTripRow[] = [];
  let places: MapPlace[] = [];
  let lastPointISO: string | null = null;
  let lastTripISO: string | null = null;
  // Tracker-status diagnostics are only meaningful for the self view:
  // "is YOUR tracker running" says nothing useful when a manager is
  // reviewing a teammate's log, and TrackerStatus is hidden there.
  const wantsSelfDiagnostics = Boolean(company) && viewingSelf;
  const wantsTeamHealth = Boolean(company) && isManager && drivers.length >= 1;

  // These six reads are mutually independent: they hit different tables
  // and not one of them consumes another's result. They used to be
  // awaited one after another, so the page paid the SUM of six round
  // trips (measured against the live account: 762 ms) to learn six
  // unrelated facts. Issued together it pays the slowest single one
  // (measured 247 ms). The one read that genuinely does have a
  // dependency stays sequential below: the recovery count needs the
  // health verdict.
  const [
    scopedTrips,
    placeRes,
    lastPointRes,
    lastTripRes,
    selfHealth,
    teamHealth,
    awaitingDecision,
    selfStatusRes,
  ] = await Promise.all([
      company
        ? // PRIVACY. Every restriction is applied in the query, server
          // side: your own drives come back whole, anyone else's are
          // narrowed to confirmed business trips. Nothing personal is
          // fetched and then hidden. See lib/mileage/team-scope.ts +
          // team-scope.test.ts; RLS does NOT enforce this, a manager may
          // read every trip in the company, so these filters are the only
          // barrier.
          // One page of the newest drives, with no date floor. The page
          // used to ask for a window computed from ?range=, which showed
          // a blank screen to a driver whose fixes had not finished
          // uploading. See lib/mileage/drive-page.ts.
          loadDrivePage<ServerTripRow>(admin, {
            companyId: company.id,
            scope,
          })
        : Promise.resolve([] as ServerTripRow[]),
      company
        ? admin
            .from("mileage_places")
            .select("id, kind, label, lat, lng")
            .eq("company_id", company.id)
        : Promise.resolve({ data: null }),
      // Most recent GPS point ingested by THIS user, across any company
      // they belong to. mileage_points has no driver_user_id; join
      // through the trip. A single 1-row fetch, so the page render cost
      // is constant regardless of how many points exist.
      wantsSelfDiagnostics
        ? admin
            .from("mileage_points")
            .select("captured_at, trip:mileage_trips!inner(driver_user_id)")
            .eq("trip.driver_user_id", user.id)
            .order("captured_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      wantsSelfDiagnostics
        ? admin
            .from("mileage_trips")
            .select("started_at")
            .eq("driver_user_id", user.id)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // Tracking-health check (self only, you can't fix another driver's
      // phone). When drives aren't being captured, warn + offer recovery.
      wantsSelfDiagnostics
        ? assessMileageTrackingHealth(admin, user.id, company!.id)
        : Promise.resolve(null),
      // Team drive-tracking health (manager-only), computed from raw
      // uploads so it is accurate even for a teammate on an old build.
      // Surfaces a driver whose phone went silent or has been parked, the
      // failure that used to go unnoticed until a week of drives had
      // already gone missing.
      wantsTeamHealth
        ? loadTeamTrackingHealth(admin, company!.id, drivers, Date.now())
        : Promise.resolve([]),
      // How many of the VIEWER'S OWN drives are waiting on a decision,
      // across every date. Range-independent on purpose: this page opens
      // on "Today", and the driver holding ten pending drives had none
      // from today, so a range-scoped count told them they were caught
      // up. Joining the parallel group means the page pays the slowest
      // member rather than the sum, and this is a single indexed head
      // request (0.25 ms measured against the live account), so the
      // group's cost does not move. See lib/mileage/awaiting-decision.ts.
      company
        ? countDrivesAwaitingDecision(admin, user.id)
        : Promise.resolve(0),
      // The viewer's own phone, in its own words (self only). The
      // heartbeat row already names the setting that stops capture,
      // Location at While Using above all, and a driver who opens this
      // page with that row written should read it here, not find out
      // from a manager nine days later. Columns pre-exist; no new query
      // shape, one indexed row.
      wantsSelfDiagnostics
        ? admin
            .from("mileage_device_status")
            .select("platform, location_authorization, background_refresh, low_power_mode, battery_optimized, tracking_enabled")
            .eq("driver_user_id", user.id)
            .eq("company_id", company!.id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  if (company) {
    // The privacy strip feeds the passenger partition DIRECTLY, so no name
    // in scope ever holds the unpartitioned rows for a later edit to
    // render by accident. A teammate's row can never be a passenger one
    // anyway (loadScopedTrips restricts foreign drives to business), so
    // everything held back here is the viewer's own.
    ({ logged: trips, excluded: excludedTrips } = partitionLoggedTrips(
      stripForeignPrivateTrips(scopedTrips, user.id),
    ));

    places = (placeRes.data ?? []) as unknown as MapPlace[];
    lastPointISO =
      (lastPointRes.data as { captured_at?: string } | null)?.captured_at ??
      null;
    lastTripISO =
      (lastTripRes.data as { started_at?: string } | null)?.started_at ?? null;

  }

  // Confirmed business drives only, the same rule /mileage/business
  // applies since #616, from the same function so the two pages cannot
  // drift apart.
  //
  // WHY. These two stats disagreed with each other, which was visible on
  // a real phone on 2026-08-24: the miles counted every business drive
  // while the deduction counted only what was actually claimable,
  // because an unconfirmed drive carries zero cents until the driver
  // agrees with the machine's call. That driver's screen read 23.7
  // business miles against 5.34 USD, an implied 22 cents a mile against
  // a real rate of 76, of which 16.7 miles were three drives nobody had
  // confirmed. A driver reading that concludes the app is underpaying
  // them, and the honest answer is that most of those miles are not
  // settled yet.
  //
  // The drives are not hidden by this. The "Needs your call" control
  // above counts them and one tap settles either undecided state, at
  // which point the miles and the money appear together.
  const businessSplit = splitScheduleC(
    trips.filter((t) => t.classification === "business"),
  );
  const businessMiles = businessSplit.settledMiles;
  const deductionCents = businessSplit.settledCents;
  // How many drives are waiting on the viewer. NOT derived from `trips`:
  // that array is scoped to the selected range, and this page opens on
  // "Today". Production on 2026-08-24 had one driver holding ten drives
  // awaiting a decision, the newest from the day before, so a
  // range-scoped number greeted them with "All caught up".
  //
  // It also used to count `classification === "unclassified"` alone,
  // which by August was the rarer of the two undecided states. Sixteen
  // production drives carried `needs_confirmation`: classified business
  // by the machine with no place evidence behind the call, held out of
  // the Schedule C headline by #616, and absent from every count here.
  // The product withheld the deduction and never asked. Both states are
  // the same request of the driver, and one tap in the review deck
  // settles either. See lib/mileage/awaiting-decision.ts.
  const awaitingCount = awaitingDecision;
  const showsOwnQueue = viewingSelf || viewingAll;

  // A drive's saved endpoints, by place id. mileage_trips stores the two
  // place uuids and no coordinates, so this is what turns
  // `start_place_id` into "Office" on the first paint, with no geocoder
  // and no polyline. Same helper as the drives route uses for the pages
  // appended after this one, so page one and page two cannot disagree
  // about what a place is called (lib/mileage/place-names.ts).
  const placeIndex = indexPlaces(places);

  // Belt-and-braces, in the same spirit as stripForeignPrivateTrips: the
  // partition above already removed every passenger drive, and the map has
  // no colour for one because it must never draw one. Re-stating it here
  // as a real runtime check means a future edit that renders the
  // unpartitioned rows still cannot put an excluded route on the map.
  const drawable = trips.filter(
    (t): t is ServerTripRow & { classification: MapTrip["classification"] } =>
      t.classification !== "passenger",
  );
  // Identity, classification and driver: everything the map needs about a
  // drive except the drive itself. The routes are NOT here. Reading them
  // on this path is what cost up to sixty sequential database round trips
  // before the page sent a byte (the "slow to load drives" report, guarded
  // by lib/mileage/drive-first-paint.test.ts), so MileageMapRoutes asks
  // for all of them in one request once the page is on screen.
  const mapTrips: RoutelessTrip[] = drawable.map((t) => ({
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

  // The health verdict itself was fetched in the parallel group above.
  // Only the recovery count is left here, because it is the one read that
  // genuinely depends on that verdict: it is asked for solely to size the
  // "recover lost drives" offer, and a healthy tracker never shows one.
  const health = selfHealth;
  // A driver who turned tracking off is not alarmed about their own
  // choice (the same rule as evaluateDriveTrackingHealth's "off").
  const selfStatus = (selfStatusRes?.data ?? null) as {
    platform: string | null;
    location_authorization: string | null;
    background_refresh: boolean | null;
    low_power_mode: boolean | null;
    battery_optimized: boolean | null;
    tracking_enabled: boolean | null;
  } | null;
  const selfCause =
    selfStatus && selfStatus.tracking_enabled !== false
      ? evaluateDeviceCause({
          platform: selfStatus.platform,
          locationAuthorization: selfStatus.location_authorization,
          backgroundRefresh: selfStatus.background_refresh,
          lowPowerMode: selfStatus.low_power_mode,
          batteryOptimized: selfStatus.battery_optimized,
          trackingEnabled: selfStatus.tracking_enabled,
        })
      : null;
  const selfCauseText =
    selfCause && selfStatus
      ? describeDeviceCause(selfCause, selfStatus.platform, "driver")
      : null;
  // Does the head carry a tracking marker at all? Asked here, from the
  // alert's own rule (driversNeedingAttention), because the head must
  // not render an empty marker: a marker that appears on every visit and
  // says nothing is the noise this screen was cut for.
  const teamNeedsAttention =
    isManager && driversNeedingAttention(teamHealth).length > 0;
  const selfNeedsAttention =
    viewingSelf && (health?.status === "degraded" || Boolean(selfCauseText));

  // Whose drives these are, in the words the head says them in. One
  // line replaces the breadcrumb, the two-line title and the "Reviewing
  // X's drives" strip: the strip explained in a paragraph what naming
  // the driver says in two words, and the breadcrumb duplicated the nav
  // AppHeader already renders.
  const whoseDrives = viewingAll
    ? "All drivers"
    : viewingSelf
      ? "Your drives"
      : driverNameById.get(viewingDriverId ?? "") ??
        viewingDriverLabel?.split(" · ")[0] ??
        "A teammate";

  let recoverable = 0;
  if (company && viewingSelf && health?.status === "degraded") {
    recoverable = await countRecoverableApproxTrips(
      admin,
      user.id,
      company.id,
      new Date(Date.now() - 90 * 86_400_000).toISOString(),
    );
  }

  // The head's two slots, built once and handed to whichever arm renders
  // the head. Server-rendered nodes travelling as props into a client
  // component, which is how the manager's switch and the tracking detail
  // reach a head that DriveLog renders.
  const driverSwitcher = showDriverPicker ? (
    <DriverPicker
      selfUserId={user.id}
      drivers={drivers}
      current={viewingAll ? ALL_DRIVERS : viewingDriverId}
    />
  ) : null;

  // A marker ONLY when a phone needs attention, which is why both arms
  // are decided above rather than rendered unconditionally and left to
  // return null: an empty marker still costs a line on the identity row.
  const trackingMarker =
    teamNeedsAttention || selfNeedsAttention ? (
      <>
        {teamNeedsAttention ? <TeamTrackingHealth rows={teamHealth} /> : null}
        {selfNeedsAttention ? (
          <details className="w-full rounded-xl border border-amber-300 bg-amber-50/60">
            <summary className="mono-label flex min-h-11 cursor-pointer select-none list-none items-center gap-2 px-3 text-amber-900">
              <WarningIcon className="size-4 shrink-0" />
              Tracking needs attention
            </summary>
            <div className="px-1 pb-1">
              <TrackingHealthBanner
                reason={health?.status === "degraded" ? health.reason ?? "" : ""}
                cause={
                  selfCauseText
                    ? `${selfCauseText.short}. ${selfCauseText.fix}`
                    : null
                }
                recoverable={recoverable}
                recoverAction={recoverApproximateTrips}
              />
            </div>
          </details>
        ) : null}
      </>
    ) : null;

  return (
    <main id="main" className="min-h-screen">
      <AppHeader email={user.email ?? undefined} />
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:pl-60 xl:pl-64 2xl:pl-72 lg:max-w-none lg:mx-0 lg:pr-8 xl:pr-12 2xl:pr-16 py-6 sm:py-10">
        {!company ? (
          <>
            <h1 className="display text-xl text-[var(--foreground)]">
              Your drives
            </h1>
            <p className="mt-4 text-sm text-ink-soft">
              Join or create a company to start tracking business
              mileage.
            </p>
          </>
        ) : (
          <>
            {/* The freshness pass was still running when this render had
                to go out, so the list below may be missing a drive that is
                about to land. Waits for that one run and refreshes once.
                Renders nothing, and is not rendered at all when finalize
                finished inside its budget. */}
            {finalizeOutstanding ? <FinalizeSettleRefresh /> : null}
            {/* Re-renders this page when the driver comes back to the app.
                Different hole from the one above: that one covers a
                freshness pass still running as the page shipped, this one
                covers a page that was correct when it shipped and has
                since gone stale in a WebView the OS kept alive across a
                drive. Renders nothing, never polls, and refetches the
                payload rather than reloading the document, which would
                tear down the live tracker. */}
            <MileageAutoRefresh />
            {/* THE HEAD. It was a breadcrumb, a two-line title, a
                company line, a tracking alert, a driver selector, a Team
                view row, a "needs a quick call" card and eight pills in
                five treatments; measured at 390px it put the window
                filter at 769px and the first drive row at 1405px.
                Everything it carried that is still a capability is
                either on this line or below the list.

                THE TEAM OVERLAY RENDERS IT HERE; the single-driver arm
                hands the same three things to DriveLog and lets that
                component render it, because the total under the identity
                line has to describe the drives the filter is showing and
                DriveLog is what holds them. The overlay has no filter,
                so its total already describes everything it draws. */}
            {viewingAll ? (
              <MilesHead
                who={whoseDrives}
                where={company.name}
                miles={businessMiles}
                deductionCents={deductionCents}
                driveCount={trips.length}
                awaiting={showsOwnQueue ? awaitingCount : 0}
                switcher={driverSwitcher}
                tracking={trackingMarker}
              />
            ) : null}

            {viewingAll ? (
              // Team overlay: a read-only map of everyone's trails (one
              // colour per driver) + a per-driver rollup. Per-trip triage
              // (reclassify / delete) stays on a single driver's log, so
              // the mixed multi-owner overlay never exposes those actions.
              <>
                <div className="mt-4">
                  <MileageMapRoutes
                    trips={mapTrips}
                    places={places}
                    height={460}
                  />
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
              /* The filter, the map and the trip list share one client
                 owner so a tap on the window changes the list without a
                 round trip, and so "Review" on a trip focuses that single
                 drive on the map with only ONE trip in review at a time.
                 The list is grouped + timezone-aware (local, not Vercel
                 UTC); Business/Personal are exact-match toggles that show
                 nothing selected for an unclassified drive.

                 Both arrays are handed over in the drives route's own
                 payload shape, so the page appended after this one is the
                 same kind of thing as this one. The endpoint names are
                 resolved HERE, on the server, rather than handing the
                 whole place list to the client: the row renders a name,
                 not a lookup table. */
              <DriveLog
                who={whoseDrives}
                where={company.name}
                /* Zero when the viewer is reading somebody else's log:
                   the queue is the viewer's own and the deck only
                   settles their drives. */
                awaiting={showsOwnQueue ? awaitingCount : 0}
                switcher={driverSwitcher}
                tracking={trackingMarker}
                initialDrives={trips.map<SentDrive>((t) => ({
                  ...t,
                  ...tripPlaces(placeIndex, t),
                }))}
                initialExcluded={excludedTrips.map<SentDrive>((t) => ({
                  ...t,
                  ...tripPlaces(placeIndex, t),
                }))}
                companyId={company.id}
                driverParam={driverParam}
                places={places}
                reclassify={reclassifyTrip}
                deleteTrip={deleteTrip}
                companies={memberships.map((m) => ({
                  id: m.company.id,
                  name: m.company.name,
                }))}
                moveTripCompany={moveTripCompany}
              />
            )}

            {/* EVERYTHING ELSE, BELOW THE DRIVES. Each of these is a
                place you go or a thing you set up, not a thing you
                read. The drives are what the screen is for, so they
                come first and these keep every capability one scroll
                away.

                The stat tiles that used to sit here went with them:
                business miles, the deduction and the waiting count are
                the head now, and a second copy below the list was the
                same three numbers asked for twice. */}
            <div className="mt-10 border-t border-edge pt-4">
              <h2 className="mono-label">More</h2>
              <nav aria-label="Mileage tools" className="mt-1 grid">
                <Link
                  // The business view defaults to year to date on its
                  // own, so this link needs no query at all.
                  href="/mileage/business"
                  className="min-h-11 flex items-center text-sm text-[var(--foreground)] underline decoration-dotted underline-offset-4"
                >
                  Business breadcrumbs
                </Link>
                {/* Saved places: a "work" place here auto-classifies
                    every future trip that touches it. */}
                <Link
                  href="/mileage/places"
                  className="min-h-11 flex items-center text-sm text-[var(--foreground)] underline decoration-dotted underline-offset-4"
                >
                  Saved places
                </Link>
                {/* The per-user schedule bounds when auto-resume runs;
                    the toggle below is still the kill switch. */}
                <Link
                  href="/mileage/schedule"
                  className="min-h-11 flex items-center text-sm text-[var(--foreground)] underline decoration-dotted underline-offset-4"
                >
                  Schedule
                </Link>
              </nav>

              {/* What the team overlay shows and what teammates keep
                  private. It was above the map, where it said the same
                  thing on every visit; the way back to the manager's own
                  log is the switch on the identity line. */}
              {viewingAll ? <TeamViewNote selfUserId={user.id} /> : null}

              {/* Auto-track toggle + tracker diagnostics are self-only:
                  you cannot flip another driver's phone tracker. */}
              {viewingSelf ? (
                <div className="mt-4">
                  <MobileOnly
                    title="Automatic mileage tracking"
                    description="Drive detection runs in the Taxottic mobile app."
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

              {/* Manual backfill entry, collapsed by default. The user
                  ALWAYS has a way to log a drive even if the tracker
                  missed it (the realistic scenario, given GPS background
                  capture on Android is best-effort). Self-only: a manual
                  trip is always logged under the current user. */}
              {viewingSelf ? <ManualLogTrip action={addManualTrip} /> : null}
              {/* Route reconstruction, the "phone died mid-drive"
                  recovery. Enter the stops; we compute the distance. */}
              {viewingSelf ? (
                <CompleteDriveFromStops action={addRouteTrip} />
              ) : null}
              {/* "My app closed on the drive back and the drive never
                  showed." Sweeps 45 days of staged points, closes drives
                  the phone left open, and reports what it could NOT turn
                  into a drive rather than reporting silence. */}
              {viewingSelf ? <RecoverLostDrives /> : null}
            </div>

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
