"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
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
import { filterDrives, type FilterKey } from "@/lib/mileage/drive-filter";
import { splitScheduleC } from "@/lib/mileage/schedule-c-totals";
import { MilesHead } from "@/components/mileage/MilesHead";
import { partitionLoggedTrips } from "@/lib/mileage/passenger";
import { isAwaitingDecision } from "@/lib/mileage/awaiting-decision";
import type { SentDrive } from "@/app/api/mileage/drives/route";

/**
 * How many consecutive empty pages end the list. See {@link emptyPages}
 * inside the component for why this is not one.
 */
const END_OF_LIST_EMPTY_PAGES = 2;

/** What a failed load says. Plain, and it names the next action, because
 *  the failure a driver cannot tell from a dead control is the failure
 *  this whole change was about. */
const LOAD_FAILED = "Could not load older drives. Tap to try again.";

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
  /**
   * WHO OWNS THE LIST, and why this is not `useState(initialDrives)`.
   *
   * The server owns page one. The client owns only the pages it
   * appended. Seeding state from the prop once and never resyncing
   * latches the FIRST server payload for the lifetime of the mount, and
   * every `revalidatePath("/mileage")` after that is thrown away: the
   * reclassify action succeeds, the page re-renders with the new row,
   * this component keeps the old one, and the row stays
   * `aria-pressed="false"` with the total at zero and no deduction. A
   * deleted drive stays in the list for the same reason. The only thing
   * that moved was the head's waiting count, because that is a
   * pass-through prop and never went through this latch, so the number
   * dropped while the row it pointed at did not change: the owner's own
   * "does not react when you click" complaint, rebuilt on the control
   * the whole screen was reorganised around.
   *
   * So page one is READ from the prop on every render, and `appended`
   * holds only what "load more" fetched. A server revalidate now reaches
   * the rows.
   *
   * KNOWN RESIDUAL, stated rather than hidden: a revalidate refreshes
   * page one only, so a drive on an APPENDED page keeps the
   * classification and the deduction it was fetched with until the log
   * is reloaded. Reclassifying it is not faked locally, because this
   * component does not know the IRS rate for the drive's tax year and a
   * deduction invented on the client is worse than one that has not
   * refreshed yet. The drives that want a decision are overwhelmingly
   * the newest ones, which are page one.
   */
  const [appended, setAppended] = useState<SentDrive[]>([]);
  const [appendedExcluded, setAppendedExcluded] = useState<SentDrive[]>([]);
  const drives = useMemo(
    () => append(initialDrives, appended),
    [initialDrives, appended],
  );
  const excluded = useMemo(
    () => append(initialExcluded, appendedExcluded),
    [initialExcluded, appendedExcluded],
  );
  /**
   * The chosen window, and the instant it was chosen at. Read from the
   * clock in the tap handler rather than during render, for the reason
   * spelled out in DriveFilter: a re-render is not an event, and it must
   * not move the boundary under a list somebody is reading. "All" spans
   * every instant, so the initial value needs no clock read.
   */
  const [picked, setPicked] = useState<{ key: FilterKey; at: number }>({
    key: "all",
    at: 0,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * THE END-OF-LIST SIGNAL: TWO well-formed pages in a row that came back
   * with zero drives.
   *
   * Not `page.length < DRIVE_PAGE_SIZE`. loadDrivePage pages on a tuple
   * cursor and drops the rows it has already shown, so a cluster of
   * drives sharing one instant can return a short page that is not the
   * end at all. Treating short as final would hide every drive behind
   * such a cluster, permanently, with no error anywhere to say so.
   *
   * And not ONE empty page either, which is what this held first. An
   * empty array is not always an answer: loadScopedTrips swallows a
   * Supabase error into `data ?? []` (lib/mileage/team-scope.ts) and the
   * route answers `{ drives: [] }` when a membership does not resolve, so
   * a 200 carrying nothing can be a blip rather than the end of the log.
   * Latching on the first one meant a single blip switched "load more"
   * off for the rest of the session, silently, with no way back short of
   * a reload. One empty page is "none right now" and leaves the control
   * usable; two consecutive ones are the end. A page with drives in it
   * clears the count, and a failure never touches it at all, because a
   * request that did not answer has said nothing about what is left.
   */
  const [emptyPages, setEmptyPages] = useState(0);
  const atEnd = emptyPages >= END_OF_LIST_EMPTY_PAGES;

  const loadOlder = useCallback(async () => {
    if (loading || atEnd) return;
    setError(null);
    // The cursor is the oldest row HELD, across both halves. A passenger
    // drive is out of the log but it is still a row the previous page
    // returned, so cursoring past it would ask the server for drives it
    // has already sent.
    const oldest = oldestOf([...drives, ...excluded]);
    if (!oldest) return;
    setLoading(true);
    try {
      // A TUPLE cursor. `beforeId` is not decoration: without it, two
      // drives that started in the same millisecond, which is ordinary at
      // GPS precision, straddle the page boundary and whichever one was
      // not already on screen is skipped for good. See
      // lib/mileage/drive-page.ts.
      const qs = new URLSearchParams({
        company: companyId,
        before: oldest.started_at,
        beforeId: oldest.id,
      });
      if (driverParam) qs.set("driver", driverParam);
      const res = await fetch(`/api/mileage/drives?${qs.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        setError(LOAD_FAILED);
        return;
      }
      const body = (await res.json()) as { drives?: unknown };
      // A well-formed answer is an ARRAY. Anything else, including a
      // `{ error }` body the route returns with a 200, is not an answer
      // about what is left in the log and must not count towards the end
      // of it.
      if (!Array.isArray(body.drives)) {
        setError(LOAD_FAILED);
        return;
      }
      const page = body.drives as SentDrive[];
      if (page.length === 0) {
        setEmptyPages((n) => n + 1);
        return;
      }
      setEmptyPages(0);
      // The route does not partition, so this page does it on arrival:
      // without it, a drive the driver already said they were riding in
      // would walk straight back into the log.
      const split = partitionLoggedTrips(page);
      setAppended((prev) => append(prev, split.logged));
      setAppendedExcluded((prev) => append(prev, split.excluded));
    } catch {
      // A rejected fetch is an offline phone or a dropped connection, and
      // it was previously unhandled: the promise rejected, the spinner
      // never cleared and nothing on screen said a word.
      setError(LOAD_FAILED);
    } finally {
      setLoading(false);
    }
  }, [atEnd, companyId, driverParam, drives, excluded, loading]);

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
  const { routes, settled } = useTripRoutes(drives.map((d) => d.id));

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
          onChange={(k) => setPicked({ key: k, at: Date.now() })}
          onLoadOlder={atEnd ? undefined : loadOlder}
          loadingOlder={loading}
          olderError={error}
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

/**
 * The oldest row of a set, by start instant, with the smaller id
 * breaking a tie.
 *
 * The tie-break matches lib/mileage/drive-page.ts, which sorts ties by id
 * DESCENDING, so the last row of a tied cluster is the one with the
 * smallest id. Picking any other member of the cluster as the cursor
 * would ask the server to re-send the rest of it.
 */
function oldestOf(rows: readonly SentDrive[]): SentDrive | null {
  let best: SentDrive | null = null;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const row of rows) {
    const at = new Date(row.started_at).getTime();
    if (Number.isNaN(at)) continue;
    if (at < bestAt || (at === bestAt && best !== null && row.id < best.id)) {
      best = row;
      bestAt = at;
    }
  }
  return best;
}

/** Append, dropping any id already held. A double tap or an overlapping
 *  cursor would otherwise give React two rows with the same key and the
 *  reader the same drive twice. */
function append(prev: SentDrive[], incoming: SentDrive[]): SentDrive[] {
  const held = new Set(prev.map((d) => d.id));
  const fresh = incoming.filter((d) => !held.has(d.id));
  return fresh.length === 0 ? prev : [...prev, ...fresh];
}
