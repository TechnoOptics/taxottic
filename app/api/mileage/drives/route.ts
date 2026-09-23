import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getMyCompanies } from "@/lib/auth";
import { DRIVE_PAGE_SIZE, loadDrivePage } from "@/lib/mileage/drive-page";
import { resolveTripScope } from "@/lib/mileage/team-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Older drives, and one drive's polyline.
 *
 * The page no longer fetches thumbnails on its render path (see
 * lib/mileage/drive-first-paint.test.ts), so each row asks for its own
 * route here when it nears the viewport, and the end of the list asks
 * for the next page.
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
    // Ownership FIRST, before a single point is read. The trip ids this
    // route hands out came from a page already scoped to the caller, but
    // a uuid in a query string is supplied by the caller, not by us, and
    // the service client below bypasses RLS entirely: the
    // `mileage_trips manager + firm read` policy would let a manager read
    // a colleague's private movements, and service role skips even that.
    // So this probe is the whole barrier.
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
      .eq("id", trip)
      .eq("driver_user_id", user.id)
      .maybeSingle();
    // Not the caller's drive, or no such drive. The two cases answer
    // identically on purpose: a distinct status for "exists but is not
    // yours" would turn this endpoint into an oracle for guessing which
    // trip ids are real.
    if (!owned) return NextResponse.json({ points: [] });

    const { data } = await admin.rpc("mileage_trip_polylines", {
      p_trip_ids: [trip],
      p_max: POLYLINE_VERTICES,
    });
    const rows = (data ?? []) as PolylineRow[];
    return NextResponse.json({
      points: rows.map((r) => ({
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
  return NextResponse.json({ drives });
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
