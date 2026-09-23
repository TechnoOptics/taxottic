import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { DRIVE_PAGE_SIZE, loadDrivePage } from "@/lib/mileage/drive-page";

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
 * Both answers are scoped to the caller, and the caller is the session.
 * A drive log is a location history: it says where somebody was, minute
 * by minute. The driver is therefore NEVER read from the query string,
 * because anything in the query string is chosen by whoever is asking.
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

  // The company IS taken from the query string, and safely so: the scope
  // below pins driver_user_id to the session as well, so naming a company
  // the caller does not belong to returns nothing rather than somebody
  // else's drives.
  const companyId = sp.get("company") ?? "";
  if (!companyId) {
    return NextResponse.json({ error: "missing_company" }, { status: 400 });
  }

  // The cursor is a TUPLE, not a bare timestamp. Drives that share an
  // instant are common at millisecond GPS precision, and a timestamp-only
  // cursor permanently skips whichever tied drive had not been shown when
  // the other crossed a page boundary. See lib/mileage/drive-page.ts.
  const before = sp.get("before") ?? undefined;
  const beforeId = sp.get("beforeId") ?? undefined;

  const drives = await loadDrivePage<DriveRow>(admin, {
    companyId,
    scope: { kind: "self", driverUserId: user.id },
    before,
    beforeId,
    limit: DRIVE_PAGE_SIZE,
  });
  return NextResponse.json({ drives });
}
