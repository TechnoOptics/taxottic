import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMyCompanies } from "@/lib/auth";
import { DRIVE_PAGE_SIZE, loadDrivePage } from "@/lib/mileage/drive-page";
import { resolveTripScope } from "@/lib/mileage/team-scope";
import {
  indexPlaces,
  tripPlaces,
  type PlaceRow,
  type SavedPlace,
} from "@/lib/mileage/place-names";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Older drives, and the polylines for one drive or for a page of them.
 *
 * The page no longer fetches thumbnails on its render path (see
 * lib/mileage/drive-first-paint.test.ts), so each row asks for its own
 * route here when it nears the viewport, the page's big map asks for
 * every route it draws in one batch, and the end of the list asks for
 * the next page.
 *
 * A drive log is a location history: it says where somebody was, minute
 * by minute. So nothing in the query string is TRUSTED here. That is not
 * the same as refusing to read it: `?driver=` is read and then laundered
 * through resolveTripScope against a roster the server loaded from the
 * caller's own membership, which is exactly what that helper exists for
 * (lib/mileage/team-scope.ts). A non-manager gets their own drives
 * whatever they ask for; a manager gets a teammate only if that teammate
 * is genuinely on their roster; anything else collapses to `self`.
 *
 * The polyline branch does NOT go through that helper, deliberately. See
 * the comment on its ownership probe below.
 */

/**
 * Vertices per drive. The same bound /mileage/classify uses, and the
 * reason this route needs no paging loop at all: the RPC strides a drive
 * of any length down to at most this many points, always keeping the
 * first and last fix (supabase/migrations/20260601000001_mileage_trip_polylines.sql).
 * One round trip, bounded work, whatever the drive.
 */
const POLYLINE_VERTICES = 250;

/**
 * How many drives one request may ask for.
 *
 * DRIVE_PAGE_SIZE, because the only batch caller is the page's 460px
 * map and it draws the drives the page loaded, which is exactly one
 * page of them. So the cap never truncates a map the page could build;
 * what it bounds is a hand-written query string.
 */
const POLYLINE_BATCH = DRIVE_PAGE_SIZE;

/**
 * Rows one response may carry, and the reason the vertex budget shrinks
 * as the batch grows.
 *
 * PostgREST truncates ANY response at max-rows (1000). The page used to
 * hit this exactly here, with 250 vertices per drive across a whole
 * range, and paged around it in a .range() loop bounded at 60,000 rows.
 * A single request cannot page. So instead of paging, the batch spends
 * a fixed row budget across the drives in it: the truncation this
 * avoids does not fail loudly, it drops whichever drives sort last by
 * trip_id (effectively at random) and their routes simply never appear.
 *
 * 900 rather than 1000 is headroom: the RPC's stride is integer
 * division, so a drive whose fix count sits just above the budget comes
 * back with a few more points than asked for.
 */
const POLYLINE_ROW_BUDGET = 900;

/** Fewer vertices than this is not a route, it is a scribble. */
const POLYLINE_MIN_VERTICES = 12;

/**
 * Vertices per drive for a batch of `count` of them.
 *
 * READ THIS BEFORE RAISING POLYLINE_BATCH OR POLYLINE_VERTICES. The
 * whole batch comes back in ONE PostgREST response, and PostgREST
 * truncates any response at max-rows, which is 1000 on this project. So
 * the budget is a product, not two independent numbers:
 *
 *     rows returned  ~=  count * verticesPerDrive(count)
 *     and that must stay under 1000, always
 *
 * which is why the per-drive figure SHRINKS as the batch grows:
 *
 *      1 drive  -> 250 vertices,    250 rows   (the row thumbnail path)
 *      4 drives -> 224 each,        896 rows
 *     10 drives ->  89 each,        890 rows
 *     60 drives ->  14 each,        840 rows   (a full page, the map)
 *
 * Raising either constant without re-checking that product does not
 * fail loudly. The response is simply cut at 1000 rows, and because the
 * RPC ends `order by trip_id, captured_at` the rows that vanish are
 * whole drives, whichever sort last by uuid, effectively at random.
 * Their routes never appear and the map reads as "those drives have no
 * route yet". That is this feature's standing failure mode, and it is
 * precisely the bug the deleted server-side .range() loop existed to
 * work around. One request cannot page, so it budgets instead.
 *
 * Pinned by "keeps every batch size inside one PostgREST page" in
 * route.test.ts, which walks the batch sizes rather than trusting this
 * comment.
 */
function verticesPerDrive(count: number): number {
  return Math.max(
    POLYLINE_MIN_VERTICES,
    Math.min(POLYLINE_VERTICES, Math.floor(POLYLINE_ROW_BUDGET / count) - 1),
  );
}

/**
 * The trip ids in `?trip=`: a comma-separated list, de-duplicated,
 * blanks dropped, capped at POLYLINE_BATCH. Nothing here is validated
 * as a uuid on purpose. An id that is not one simply fails to match the
 * ownership probe below, which is the same answer a real id belonging
 * to somebody else gets, and the one answer this endpoint is allowed to
 * give.
 */
function parseTripIds(raw: string): string[] {
  const ids = new Set<string>();
  for (const part of raw.split(",")) {
    const id = part.trim();
    if (id.length > 0) ids.add(id);
    if (ids.size >= POLYLINE_BATCH) break;
  }
  return [...ids];
}

type PolylineRow = {
  trip_id: string;
  lat: number;
  lng: number;
  captured_at: string;
};

/** The columns loadDrivePage sorts and pages on, plus what a row renders with. */
type DriveRow = {
  id: string;
  driver_user_id?: string;
  started_at: string;
  ended_at: string;
  distance_miles: number;
  classification: "business" | "personal" | "unclassified" | "passenger";
  tax_year: number;
  deduction_cents: number;
  needs_confirmation: boolean | null;
  /** The saved place each end matched. TRIP_SELECT has carried these
   *  since the row started naming its endpoints, and PostgREST returns
   *  every selected column, so they were already in this payload before
   *  they were declared here. Declared now because the handler reads
   *  them. */
  start_place_id?: string | null;
  end_place_id?: string | null;
};

/** A drive as this route SENDS it: the row, plus the two ends resolved
 *  to names. The client never sees a place id it would have to look up,
 *  because it has no places to look them up in.
 *
 *  EXPORTED because components/mileage/DriveLog.tsx appends this payload
 *  to a list it already holds, and a contract that lives only here is one
 *  a mis-spelled field on the client silently satisfies: the row would
 *  arrive whole, render blank, and read as "no data yet", which is this
 *  feature's standing failure mode. It is a type-only import, so nothing
 *  of this module reaches the browser bundle. */
export type SentDrive = DriveRow & {
  startPlace: SavedPlace | null;
  endPlace: SavedPlace | null;
};

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createServiceClient();
  const sp = req.nextUrl.searchParams;
  const trip = sp.get("trip");

  if (trip) {
    const ids = parseTripIds(trip);
    // Nothing to check and nothing to read. Same empty answer as an id
    // that is not the caller's, for the same reason.
    if (ids.length === 0) return NextResponse.json({ points: [] });

    // Ownership FIRST, before a single point is read, and for EVERY id
    // in the batch. The trip ids this route hands out came from a page
    // already scoped to the caller, but a uuid in a query string is
    // supplied by the caller, not by us, and the service client below
    // bypasses RLS entirely: the `mileage_trips manager + firm read`
    // policy would let a manager read a colleague's private movements,
    // and service role skips even that. So this probe is the whole
    // barrier.
    //
    // One query for the whole list, not one per id. `.in()` with the
    // driver pinned answers "which of these are yours" in a single
    // indexed read, and a probe per id would be the sixty-round-trip
    // bug this branch removed, rebuilt on the server. One drive is a
    // batch of one and takes the same path, so there is a single
    // ownership rule here rather than two that can drift.
    //
    // It pins driver_user_id to the SESSION, and deliberately does not go
    // through resolveTripScope the way the list below does. The two are
    // not the same question. A manager reading a teammate's LIST is an
    // existing product decision, and the list is filtered to confirmed
    // business drives for exactly that reason. A manager pulling an
    // arbitrary trip's raw GPS track by id is not that decision: it is
    // minute-by-minute movement, the id is guessable, and nothing in the
    // request says the drive was one the list would have shown. So the
    // polyline stays strictly the caller's own.
    const { data: owned } = await admin
      .from("mileage_trips")
      .select("id")
      .in("id", ids)
      .eq("driver_user_id", user.id);
    const mine = new Set(((owned ?? []) as { id: string }[]).map((r) => r.id));
    const allowed = ids.filter((id) => mine.has(id));
    // Not the caller's drives, or no such drives. Ids that did not clear
    // are dropped in SILENCE rather than refused: the two cases answer
    // identically on purpose, because a distinct status for "exists but
    // is not yours" would turn this endpoint into an oracle for guessing
    // which trip ids are real. A batch that clears nothing reads nothing.
    if (allowed.length === 0) return NextResponse.json({ points: [] });

    const { data } = await admin.rpc("mileage_trip_polylines", {
      p_trip_ids: allowed,
      p_max: verticesPerDrive(allowed.length),
    });
    const rows = (data ?? []) as PolylineRow[];
    return NextResponse.json({
      // `trip_id` travels with every point so a batch can be grouped,
      // and it travels on the single-id answer too: a response shape
      // that depends on how many ids were asked for is a trap for
      // whoever adds the second caller. DriveThumbnail reads lat, lng
      // and captured_at and is unaffected.
      //
      // Filtered against `mine` a second time. The RPC was only handed
      // cleared ids, so this can only ever drop nothing; it is here so
      // that a future edit which widens what goes IN still cannot widen
      // what comes OUT.
      points: rows
        .filter((r) => mine.has(r.trip_id))
        .map((r) => ({
          trip_id: r.trip_id,
          lat: r.lat,
          lng: r.lng,
          captured_at: r.captured_at,
        })),
    });
  }

  // The company IS taken from the query string, but it is checked against
  // the caller's own memberships below rather than trusted, because it
  // also decides whether this caller is a manager here.
  const companyId = sp.get("company") ?? "";
  if (!companyId) {
    return NextResponse.json({ error: "missing_company" }, { status: 400 });
  }

  // The caller's role comes from their membership of THIS company, read
  // with the session client (getMyCompanies pins user_id itself, see the
  // note in lib/auth.ts about super-admins). A company the caller does
  // not belong to pages empty, for the same reason a foreign trip id
  // returns no points: an error code distinguishable from "no drives"
  // tells a stranger which company ids are real.
  const memberships = await getMyCompanies();
  const membership = memberships.find((m) => m.company_id === companyId);
  if (!membership) return NextResponse.json({ drives: [] });
  const isManager = membership.role === "manager";

  // Who this request may read. The SAME helper the page calls
  // (app/mileage/page.tsx), fed the same four inputs in the same way, so
  // the two cannot drift. Page one and page two therefore agree: a
  // manager on the team overlay keeps the team, a manager who pinned one
  // teammate keeps that teammate, everyone else keeps themselves.
  //
  // `?driver=` is read but NOT trusted, and resolveTripScope is where the
  // difference lives. It is handed the raw value plus `driverIds`, a
  // roster this server just loaded from the caller's own membership, and
  // it returns `other` only when the value is genuinely on that roster.
  // A non-manager never leaves `self` at all. Passing the raw string in
  // is the helper's documented contract, not a shortcut around it.
  const driverIds = isManager
    ? await companyDriverIds(admin, companyId)
    : [user.id];
  const scope = resolveTripScope({
    isManager,
    viewerUserId: user.id,
    driverParam: sp.get("driver") ?? "",
    driverIds,
  });

  // The cursor is a TUPLE, not a bare timestamp. Drives that share an
  // instant are common at millisecond GPS precision, and a timestamp-only
  // cursor permanently skips whichever tied drive had not been shown when
  // the other crossed a page boundary. See lib/mileage/drive-page.ts.
  const before = sp.get("before") ?? undefined;
  const beforeId = sp.get("beforeId") ?? undefined;

  const drives = await loadDrivePage<DriveRow>(admin, {
    companyId,
    scope,
    before,
    beforeId,
    limit: DRIVE_PAGE_SIZE,
  });

  // The names are resolved HERE, exactly as app/mileage/page.tsx resolves
  // them for the first page, and for the same reason: a place id means
  // nothing to a client that holds no places, and a row that cannot name
  // its endpoints is the regression this feature exists to avoid. Page
  // one and page two therefore cannot disagree, because neither of them
  // decides anything.
  //
  // One read per request, and only when a drive on this page actually
  // matched a place. Most accounts have saved none at all, and those pay
  // nothing for this.
  const index = indexPlaces(await placesFor(admin, companyId, drives));
  return NextResponse.json({
    drives: drives.map<SentDrive>((d) => ({
      ...d,
      ...tripPlaces(index, d),
    })),
  });
}

/**
 * The company's saved places, or none when this page of drives matched
 * none. Scoped by company_id, the same bound the drives themselves are
 * loaded under, so an id from another company cannot be named here: it
 * simply misses the index and the row goes unnamed rather than wrong.
 */
async function placesFor(
  admin: ReturnType<typeof createServiceClient>,
  companyId: string,
  drives: readonly DriveRow[],
): Promise<PlaceRow[]> {
  if (!drives.some((d) => d.start_place_id || d.end_place_id)) return [];
  const { data } = await admin
    .from("mileage_places")
    .select("id, kind, label, lat, lng")
    .eq("company_id", companyId);
  return (data ?? []) as unknown as PlaceRow[];
}

/**
 * Every member of `companyId`, which is what resolveTripScope counts to
 * decide whether a manager has a team at all (a manager alone in their
 * company pages as `self`, not as a one-person "team").
 *
 * Only called for a manager, and only after their membership of this
 * company has been confirmed, so the service client's reach past RLS is
 * bounded by that check rather than by the query string.
 */
async function companyDriverIds(
  admin: ReturnType<typeof createServiceClient>,
  companyId: string,
): Promise<string[]> {
  const { data } = await admin
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId);
  return ((data ?? []) as { user_id: string }[]).map((m) => m.user_id);
}
