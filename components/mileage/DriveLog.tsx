"use client";

import { type ReactNode } from "react";
import { DriveFilter } from "@/components/mileage/DriveFilter";
import { MileageReview } from "@/components/mileage/MileageReview";
import { type TripRow } from "@/components/mileage/TripList";
import { type ExcludedTripRow } from "@/components/mileage/ExcludedTrips";
import {
  useTripRoutes,
  type MapTrip,
  type MapPlace,
  type RoutelessTrip,
} from "@/components/mileage/MileageMap";
import { filterDrives } from "@/lib/mileage/drive-filter";
import { splitScheduleC } from "@/lib/mileage/schedule-c-totals";
import { MilesHead } from "@/components/mileage/MilesHead";
import { isAwaitingDecision } from "@/lib/mileage/awaiting-decision";
import { useDriveWindow } from "@/components/mileage/useDriveWindow";
import type { SentDrive } from "@/app/api/mileage/drives/route";

/**
 * The drive log's client owner: the loaded drives, the filter key, and
 * the call that appends older pages.
 *
 * WHY THIS EXISTS. The range control used to be four `<Link>`s to
 * `?range=` on a force-dynamic page. A tap started a full server render
 * with no pending state, so nothing on screen changed until it came
 * back; the owner's report was that Today and This month "do not
 * react". A filter can only answer on the tap if the list it filters is
 * already in the browser, and a list can only grow if somebody holds
 * it. That somebody is this component.
 *
 * It is deliberately the SMALLEST client boundary that can hold that
 * state. The page above stays a server component with the auth, the
 * scoped reads, the totals and every control that is not the filter;
 * TripList below stays presentational, taking `trips`. This layer holds
 * the arrays and hands both of them their props.
 *
 * The payload is {@link SentDrive}, the drives route's own row type,
 * imported rather than restated. The page maps its first page into that
 * same shape, so page one and every page appended after it are the same
 * kind of thing. A second, hand-written copy of the shape is how a
 * mis-spelled field starts rendering blank and reading as "no data yet".
 */
export function DriveLog({
  who,
  where,
  awaiting,
  switcher,
  tracking,
  initialDrives,
  initialExcluded,
  companyId,
  driverParam,
  places,
  reclassify,
  deleteTrip,
  companies,
  moveTripCompany,
}: {
  /** The head's identity line: whose drives these are, and the business
   *  they belong to. Rendered HERE rather than by the page because the
   *  total beneath it has to describe the drives the filter is showing,
   *  and this component is what holds them. */
  who: string;
  where?: string;
  /** Drives awaiting a decision across EVERY date, from the page's own
   *  indexed read. Deliberately not filtered with the rest: the page
   *  opens on the newest drives and a driver holding ten older ones was
   *  being told they were caught up (lib/mileage/awaiting-decision.ts). */
  awaiting: number;
  switcher?: ReactNode;
  tracking?: ReactNode;
  /** The newest page's drives, newest first: already scoped, stripped of
   *  a teammate's private drives and partitioned by the server. */
  initialDrives: SentDrive[];
  /** The same page's drives the driver marked "I was a passenger". Out
   *  of the log, the map and every total, kept so the tap is reversible
   *  (lib/mileage/passenger.ts). Held here rather than re-derived so the
   *  page keeps doing the partition it does today. */
  initialExcluded: SentDrive[];
  companyId: string;
  /** The teammate whose log is being read, when a manager pinned one.
   *  Forwarded verbatim to the route, which launders it through the same
   *  resolveTripScope the page used, so page two is scoped like page
   *  one. */
  driverParam: string;
  places: MapPlace[];
  reclassify: (formData: FormData) => Promise<void>;
  deleteTrip: (formData: FormData) => Promise<void>;
  companies: { id: string; name: string }[];
  moveTripCompany: (formData: FormData) => Promise<void>;
}) {
  // Every drive this screen holds, the window it is read through, and
  // the call that appends older pages. Shared with the team overlay, so
  // the tuple cursor and the end-of-list rule exist once rather than
  // twice (useDriveWindow.ts).
  const { drives, excluded, picked, pick, loadOlder, loadingOlder, olderError } =
    useDriveWindow({ initialDrives, initialExcluded, companyId, driverParam });

  const shown = filterDrives(drives, picked.key, picked.at);
  const shownExcluded = filterDrives(excluded, picked.key, picked.at);

  /**
   * The total, over WHAT IS ON SCREEN.
   *
   * It used to be computed on the server, over every loaded drive, and
   * rendered in a head that sat above a filter it knew nothing about. A
   * tap on "Last 7 days" changed the list and left the figures saying
   * what a different set came to. A total that reads as authoritative
   * and describes another set is worse than no total at all, so it moved
   * down here, to the component that owns the filtered drives.
   *
   * Confirmed business drives only, through the same splitScheduleC the
   * server used and /mileage/business uses: a machine guess must not
   * become a tax figure before a human agrees with it (#616).
   */
  const totals = splitScheduleC(
    shown.filter((d) => d.classification === "business"),
  );

  /**
   * WHERE THE WAITING COUNT GOES, and why it is decided here.
   *
   * `awaiting` is counted by driver across every company and every
   * date, on purpose. The anchor the head would like to use,
   * `#first-unclassified`, is placed by TripList among the drives
   * actually rendered: one page, one company, after this component's
   * filter. Those two sets are not the same set. A driver in two
   * companies, one holding waiting drives past page one, or one who
   * taps "Last 7 days" while the waiting drive is forty days old, would
   * read "3 waiting", tap it, and get nothing at all, because the
   * anchor is not in the document. That is the dead control this screen
   * was rebuilt to remove, rebuilt in its own replacement.
   *
   * So the anchor is promised ONLY when every drive the count refers to
   * is on screen. Otherwise the deck gets the tap: it holds all of them
   * by the same rule the count uses, and the two are held to that rule
   * at both call sites by awaiting-decision-wiring.test.ts.
   */
  const awaitingShown = shown.filter((d) =>
    isAwaitingDecision({
      classification: d.classification,
      needs_confirmation: d.needs_confirmation,
    }),
  ).length;
  const waitingHref =
    awaitingShown >= awaiting ? "#first-unclassified" : "/mileage/classify";

  // ONE fetch for the map below AND every row in the list, because they
  // want the same sixty routes. Scrolling a full page used to fire one
  // single-id request per row on top of the map's batch, at the full
  // 250-vertex budget each, for routes this component was already
  // holding: the round trips this branch deleted from the first paint,
  // arriving through the scrollbar instead.
  //
  // Keyed on every LOADED drive rather than the filtered subset, so a
  // range tap costs nothing (it filters what is already here, which is
  // this component's whole reason to exist) and a page of older drives
  // costs exactly one more request for the ids it just learned about.
  //
  // The scope travels with the batch: without it the route serves the
  // caller's own routes only, which is right for a lone guessable id and
  // wrong for a list the server itself scoped. A manager reading a
  // teammate's log would otherwise get a blank thumbnail on every row
  // and a trail-less review map.
  const { routes, settled } = useTripRoutes(
    drives.map((d) => d.id),
    { companyId, driverParam },
  );

  const tripRows = shown.map<TripRow>((d) => ({
    id: d.id,
    startedAtISO: d.started_at,
    endedAtISO: d.ended_at,
    distanceMiles: Number(d.distance_miles),
    classification: d.classification,
    deductionCents: Number(d.deduction_cents),
    needsConfirmation: d.needs_confirmation === true,
    // From the batch above, not from the server render: reading these on
    // the render path is what took sixty sequential polyline round trips
    // off the first paint. A drive the batch has not answered for yet is
    // `routePending`, which is what stops the row racing it; one it has
    // answered for and not covered stays empty, and the row fetches its
    // own when it nears the viewport.
    points: routes.get(d.id) ?? [],
    routePending: !settled.has(d.id),
    companyId,
    startPlace: d.startPlace,
    endPlace: d.endPlace,
  }));

  const excludedRows = shownExcluded.map<ExcludedTripRow>((d) => ({
    id: d.id,
    startedAtISO: d.started_at,
    endedAtISO: d.ended_at,
    distanceMiles: Number(d.distance_miles),
  }));

  // Re-stated here for the same reason the page re-states it: the map has
  // no colour for a passenger drive because it must never draw one, and a
  // runtime check means a future edit cannot put one on the map.
  const mapTrips: RoutelessTrip[] = shown
    .filter(
      (d): d is SentDrive & { classification: MapTrip["classification"] } =>
        d.classification !== "passenger",
    )
    .map((d) => ({
      id: d.id,
      classification: d.classification,
      // `notes` is selected by TRIP_SELECT and travels in the payload; it
      // is read through a cast for the same reason the page reads it
      // through one, because the row type does not declare it.
      approximate: ((d as { notes?: string | null }).notes ?? "").startsWith(
        "Approximate drive",
      ),
    }));

  return (
    <>
      <MilesHead
        who={who}
        where={where}
        miles={totals.settledMiles}
        deductionCents={totals.settledCents}
        driveCount={shown.length}
        awaiting={awaiting}
        waitingHref={waitingHref}
        switcher={switcher}
        tracking={tracking}
      />
      <div className="mt-4">
        <DriveFilter
          drives={[...drives, ...excluded]}
          picked={picked}
          onChange={pick}
          onLoadOlder={loadOlder}
          loadingOlder={loadingOlder}
          olderError={olderError}
        />
      </div>
      <MileageReview
        mapTrips={mapTrips}
        routes={routes}
        places={places}
        tripRows={tripRows}
        excludedRows={excludedRows}
        reclassify={reclassify}
        deleteTrip={deleteTrip}
        companies={companies}
        moveTripCompany={moveTripCompany}
      />
    </>
  );
}
