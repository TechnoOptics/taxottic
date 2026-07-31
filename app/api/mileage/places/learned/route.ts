import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  learnPlaces,
  MAX_LEARNED_PLACES,
  type LearnedPlace,
  type RawPoint,
} from "@/lib/mileage/places";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
 * Recompute at most weekly. Habitual places move when someone moves
 * house or changes job, neither of which is a same-day event, and the
 * clustering reads every raw point the driver has.
 */
const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

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
  const places = learnPlaces(points);
  const computedAt = new Date().toISOString();

  // Replace the whole set. Partial reconciliation would leave a stale
  // place registered on the device forever after a house move, and the
  // set is at most MAX_LEARNED_PLACES rows.
  await admin
    .from("mileage_learned_places")
    .delete()
    .eq("driver_user_id", userId)
    .eq("company_id", companyId);

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
