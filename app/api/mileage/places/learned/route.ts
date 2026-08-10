import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  learnPlaces,
  MAX_LEARNED_PLACES,
  type LearnedPlace,
  type RawPoint,
  type TripSpan,
} from "@/lib/mileage/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The learned-place list the device registers as geofences.
 *
 * GET  returns the cached list, recomputing it when stale or absent.
 * POST forces a recompute (used by the setup wizard and by support).
 *
 * Clustering runs here rather than on the device because the server
 * holds months of history where the phone holds a few thousand points
 * that vanish on reinstall, and because one list has to serve both
 * Android geofences and iOS region monitoring.
 */

/**
 * Recompute daily.
 *
 * This was weekly, and the reason was cost: clustering read up to
 * MAX_POINTS (60,000) raw rows. Trip endpoints read on the order of a
 * hundred rows, so the price no longer justifies a week of staleness,
 * and a new habitual place now arms within a day instead of seven.
 *
 * If a future change makes this path read raw points again in bulk,
 * put the week back.
 */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * How far back the clustering reads. Long enough that a fortnight of
 * annual leave does not erase home, short enough that a house move
 * stops being reinforced by ancient history within a couple of months.
 */
const HISTORY_WINDOW_DAYS = 90;

/**
 * Supabase caps a single select; a driver with three months of dense
 * capture can exceed 50k rows. The clustering only cares about points
 * either side of a gap, so a cap costs recall at the oldest end only.
 */
const MAX_POINTS = 60_000;

/**
 * Same reasoning as MAX_POINTS, for the trips query below: the primary
 * driver has around 165 trips in a 90-day window, so 2000 leaves wide
 * headroom while still bounding the work.
 *
 * The query orders DESCENDING so that a cap drops the OLDEST trips.
 * PostgREST applies limit after ordering, so an ascending order would
 * truncate the tail and throw away the most RECENT trips, which is
 * exactly backwards: a mesh exists to cover where the driver goes now,
 * and a place they stopped visiting two months ago is the one worth
 * losing. The original comment here claimed ascending dropped the
 * oldest, which was wrong in both directions.
 *
 * Order does not otherwise matter: extractEndpointCandidates sorts by
 * startMs itself before pairing.
 */
const MAX_TRIPS = 2_000;

type Admin = ReturnType<typeof createServiceClient>;

async function authorize(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }
  const companyId = req.nextUrl.searchParams.get("companyId") ?? "";
  if (!companyId) {
    return { error: NextResponse.json({ error: "missing_company" }, { status: 400 }) };
  }
  const admin = createServiceClient();
  const { data: membership } = await admin
    .from("company_members")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!membership) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }
  return { userId: user.id, companyId, admin };
}

async function loadCached(admin: Admin, userId: string, companyId: string) {
  const { data } = await admin
    .from("mileage_learned_places")
    .select("learned_key, label, lat, lng, radius_m, visits, dwell_hours, rank, computed_at")
    .eq("driver_user_id", userId)
    .eq("company_id", companyId)
    .order("rank", { ascending: true });
  return data ?? [];
}

async function recompute(
  admin: Admin,
  userId: string,
  companyId: string,
): Promise<LearnedPlace[]> {
  const sinceIso = new Date(
    Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { data, error } = await admin
    .from("mileage_points_raw")
    .select("lat, lng, captured_at")
    .eq("driver_user_id", userId)
    .eq("company_id", companyId)
    .gte("captured_at", sinceIso)
    .order("captured_at", { ascending: true })
    .limit(MAX_POINTS);
  if (error) throw new Error(error.message);

  const points: RawPoint[] = (data ?? []).map((row) => ({
    lat: row.lat as number,
    lng: row.lng as number,
    ts: Date.parse(row.captured_at as string),
  }));

  // Trip endpoints, the second candidate source.
  //
  // tracked ONLY. mileage_trips.source is constrained to
  // ('tracked', 'manual', 'route'); `route` endpoints are geocoded from
  // place names typed into the reconstruct tool and `manual` are typed
  // outright, so neither is a coordinate the phone ever reported.
  // Seeding a geofence from one would arm a region around a geocoder's
  // idea of an address. lib/mileage/finalize.ts already excludes
  // non-tracked trips for the same reason.
  const { data: tripRows, error: tripError } = await admin
    .from("mileage_trips")
    .select("id, started_at, ended_at")
    .eq("driver_user_id", userId)
    .eq("company_id", companyId)
    .eq("source", "tracked")
    .gte("started_at", sinceIso)
    .order("started_at", { ascending: false })
    .limit(MAX_TRIPS);
  if (tripError) throw new Error(tripError.message);

  // Endpoints come from the trip's own materialised points. start_place_id
  // and end_place_id are NULL on every row in production, so they cannot
  // be used for this.
  const trips: TripSpan[] = [];
  for (const row of tripRows ?? []) {
    const tripId = row.id as string;
    const [firstRes, lastRes] = await Promise.all([
      admin
        .from("mileage_points")
        .select("lat, lng")
        .eq("trip_id", tripId)
        .order("captured_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      admin
        .from("mileage_points")
        .select("lat, lng")
        .eq("trip_id", tripId)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (firstRes.error) throw new Error(firstRes.error.message);
    if (lastRes.error) throw new Error(lastRes.error.message);
    const first = firstRes.data;
    const last = lastRes.data;
    if (!first || !last) continue;
    trips.push({
      startLat: first.lat as number,
      startLng: first.lng as number,
      startMs: Date.parse(row.started_at as string),
      endLat: last.lat as number,
      endLng: last.lng as number,
      endMs: Date.parse(row.ended_at as string),
    });
  }

  const places = learnPlaces(points, trips);
  const computedAt = new Date().toISOString();

  if (places.length === 0) {
    // Geofences are the only mechanism that can restart mileage capture
    // after Android kills the app, so an empty result here must never be
    // allowed to wipe a driver's mesh. An empty learnPlaces() output is far
    // more likely to mean "no usable data this run" (a GPS outage, an
    // upload stall, a quiet week with no qualifying trips) than "this
    // driver genuinely has no habitual places". Before touching the table,
    // check whether a mesh already exists and, if so, leave it alone
    // instead of deleting it and inserting nothing in its place.
    const { data: existing, error: existingError } = await admin
      .from("mileage_learned_places")
      .select("learned_key, label, lat, lng, radius_m, visits, dwell_hours, rank")
      .eq("driver_user_id", userId)
      .eq("company_id", companyId)
      .order("rank", { ascending: true });
    if (existingError) {
      // Can't tell whether there is a mesh to protect. Fail safe: do not
      // delete. This throws, same as every other query failure in this
      // function, so the caller's own fallback (GET serves the last-known
      // cached list; POST reports the failure) takes over from here.
      throw new Error(existingError.message);
    }
    if ((existing ?? []).length > 0) {
      return existing!.map((row) => ({
        key: row.learned_key as string,
        label: row.label as LearnedPlace["label"],
        lat: row.lat as number,
        lng: row.lng as number,
        radiusM: row.radius_m as number,
        visits: row.visits as number,
        dwellHours: Number(row.dwell_hours),
        rank: row.rank as number,
      }));
    }
    // Nothing existed before either, so there is nothing to protect; fall
    // through to the normal replace path, where the delete is a no-op and
    // the insert is skipped because places.length is 0.
  }

  // Replace the whole set. Partial reconciliation would leave a stale
  // place registered on the device forever after a house move, and the
  // set is at most MAX_LEARNED_PLACES rows.
  const { error: deleteError } = await admin
    .from("mileage_learned_places")
    .delete()
    .eq("driver_user_id", userId)
    .eq("company_id", companyId);
  if (deleteError) throw new Error(deleteError.message);

  if (places.length > 0) {
    const { error: insertError } = await admin.from("mileage_learned_places").insert(
      places.map((p) => ({
        driver_user_id: userId,
        company_id: companyId,
        learned_key: p.key,
        label: p.label,
        lat: p.lat,
        lng: p.lng,
        radius_m: p.radiusM,
        visits: p.visits,
        dwell_hours: p.dwellHours,
        rank: p.rank,
        computed_at: computedAt,
      })),
    );
    if (insertError) throw new Error(insertError.message);
  }
  return places;
}

function toResponse(places: LearnedPlace[], computedAtIso: string | null) {
  return NextResponse.json({
    ok: true,
    computedAt: computedAtIso,
    maxPlaces: MAX_LEARNED_PLACES,
    places: places.map((p) => ({
      id: p.key,
      label: p.label,
      latitude: p.lat,
      longitude: p.lng,
      radius: p.radiusM,
      visits: p.visits,
      dwellHours: p.dwellHours,
    })),
  });
}

export async function GET(req: NextRequest) {
  const auth = await authorize(req);
  if ("error" in auth) return auth.error;
  const { admin, userId, companyId } = auth;

  const cached = await loadCached(admin, userId, companyId);
  const computedAtMs = cached[0]?.computed_at
    ? Date.parse(cached[0].computed_at as string)
    : null;
  const fresh = computedAtMs != null && Date.now() - computedAtMs < STALE_AFTER_MS;

  if (fresh) {
    return toResponse(
      cached.map((row) => ({
        key: row.learned_key as string,
        label: row.label as LearnedPlace["label"],
        lat: row.lat as number,
        lng: row.lng as number,
        radiusM: row.radius_m as number,
        visits: row.visits as number,
        dwellHours: Number(row.dwell_hours),
        rank: row.rank as number,
      })),
      new Date(computedAtMs).toISOString(),
    );
  }

  try {
    const places = await recompute(admin, userId, companyId);
    return toResponse(places, new Date().toISOString());
  } catch (e) {
    console.error("[learned-places] recompute failed", (e as Error).message);
    // A failed recompute must not take the device's existing mesh away.
    // Serve the stale list and say it is stale.
    return toResponse(
      cached.map((row) => ({
        key: row.learned_key as string,
        label: row.label as LearnedPlace["label"],
        lat: row.lat as number,
        lng: row.lng as number,
        radiusM: row.radius_m as number,
        visits: row.visits as number,
        dwellHours: Number(row.dwell_hours),
        rank: row.rank as number,
      })),
      computedAtMs == null ? null : new Date(computedAtMs).toISOString(),
    );
  }
}

export async function POST(req: NextRequest) {
  const auth = await authorize(req);
  if ("error" in auth) return auth.error;
  const { admin, userId, companyId } = auth;
  try {
    const places = await recompute(admin, userId, companyId);
    return toResponse(places, new Date().toISOString());
  } catch (e) {
    console.error("[learned-places] forced recompute failed", (e as Error).message);
    return NextResponse.json({ error: "recompute_failed" }, { status: 500 });
  }
}
