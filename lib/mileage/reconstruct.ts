import type { SupabaseClient } from "@supabase/supabase-js";
import { haversineMeters } from "./segmentation";

// Approximate-trip recovery.
//
// When background capture is degraded (see lib/mileage/health), the staging
// pool has no drive traces to segment, only stop-to-stop "teleport" jumps.
// This turns each qualifying jump into an APPROXIMATE trip using the
// straight-line distance between the two stops.
//
// Honesty guardrails:
//   - Straight-line UNDER-counts real road miles, so this can only
//     under-claim, never over-claim.
//   - Trips are created "unclassified" (deduction_cents = 0) so nothing is
//     asserted as a business deduction until the user reviews + classifies.
//   - The notes field flags each one as approximate.
// It is opt-in (the user taps "Recover"), never automatic.

const METERS_PER_MILE = 1609.344;
const MIN_JUMP_M = 1000; // < 1 km = jitter / a short walk, not a drive
const MAX_JUMP_M = 250_000; // > 250 km between two fixes = data glitch, skip
const MIN_DT_S = 120; // 2 min
const MAX_DT_S = 4 * 3600; // 4 h, beyond this we can't assume a single drive
const NOTE =
  "Approximate drive, reconstructed from stop-to-stop GPS after a background-tracking gap. Straight-line distance may under-count road miles; verify before claiming.";

type RawPt = { id: string; ts: number; lat: number; lng: number };

async function fetchUnconsumed(
  admin: SupabaseClient,
  userId: string,
  companyId: string,
  sinceIso: string,
): Promise<RawPt[]> {
  const PAGE = 1000;
  const MAX = 50_000;
  const out: RawPt[] = [];
  for (let from = 0; from < MAX; from += PAGE) {
    const { data, error } = await admin
      .from("mileage_points_raw")
      .select("id, captured_at, lat, lng")
      .eq("driver_user_id", userId)
      .eq("company_id", companyId)
      .is("consumed_at", null)
      .gte("captured_at", sinceIso)
      .order("captured_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) {
      out.push({
        id: r.id as string,
        ts: Date.parse(r.captured_at as string),
        lat: r.lat as number,
        lng: r.lng as number,
      });
    }
    if (data.length < PAGE) break;
  }
  return out;
}

function isJump(a: RawPt, b: RawPt): number | null {
  const m = haversineMeters(a, b);
  const dt = (b.ts - a.ts) / 1000;
  if (m < MIN_JUMP_M || m > MAX_JUMP_M || dt < MIN_DT_S || dt > MAX_DT_S) {
    return null;
  }
  return m;
}

/** How many approximate trips a recovery run would create (for the UI label). */
export async function countRecoverableApproxTrips(
  admin: SupabaseClient,
  userId: string,
  companyId: string,
  sinceIso: string,
): Promise<number> {
  const pts = await fetchUnconsumed(admin, userId, companyId, sinceIso);
  let n = 0;
  for (let i = 1; i < pts.length; i++) if (isJump(pts[i - 1], pts[i])) n++;
  return n;
}

/**
 * Create approximate trips from stop-to-stop jumps, then mark the whole
 * processed window consumed (leftover stationary heartbeats are discarded -
 * they carry no drive value). Returns the number of trips created.
 */
export async function reconstructApproximateTrips(
  admin: SupabaseClient,
  userId: string,
  companyId: string,
  sinceIso: string,
): Promise<number> {
  const pts = await fetchUnconsumed(admin, userId, companyId, sinceIso);
  if (pts.length < 2) return 0;

  let created = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const meters = isJump(a, b);
    if (meters == null) continue;

    const startedAt = new Date(a.ts).toISOString();
    const endedAt = new Date(b.ts).toISOString();
    const { data: ins, error } = await admin
      .from("mileage_trips")
      .insert({
        company_id: companyId,
        driver_user_id: userId,
        started_at: startedAt,
        ended_at: endedAt,
        distance_miles: Number((meters / METERS_PER_MILE).toFixed(3)),
        classification: "unclassified",
        tax_year: new Date(a.ts).getUTCFullYear(),
        deduction_cents: 0, // unclassified, nothing claimed until reviewed
        notes: NOTE,
      })
      .select("id")
      .single();
    if (error || !ins) {
      console.error("[reconstruct] trip insert failed", error?.message);
      continue;
    }
    // Give the trip its two endpoint points so the map can draw it (a
    // straight line between the two stops, honest for an approximate trip).
    await admin.from("mileage_points").insert([
      { trip_id: ins.id, captured_at: startedAt, lat: a.lat, lng: a.lng },
      { trip_id: ins.id, captured_at: endedAt, lat: b.lat, lng: b.lng },
    ]);
    // Consume the two endpoint fixes (and anything between) into this trip.
    await admin
      .from("mileage_points_raw")
      .update({ consumed_at: new Date().toISOString(), consumed_trip_id: ins.id })
      .eq("driver_user_id", userId)
      .eq("company_id", companyId)
      .is("consumed_at", null)
      .gte("captured_at", startedAt)
      .lte("captured_at", endedAt);
    created++;
  }

  // Sweep any remaining unconsumed points in the window (parked heartbeats
  // with no drive value) so the backlog clears and the health banner resets.
  const lastIso = new Date(pts[pts.length - 1].ts).toISOString();
  await admin
    .from("mileage_points_raw")
    .update({ consumed_at: new Date().toISOString() })
    .eq("driver_user_id", userId)
    .eq("company_id", companyId)
    .is("consumed_at", null)
    .gte("captured_at", sinceIso)
    .lte("captured_at", lastIso);

  return created;
}
