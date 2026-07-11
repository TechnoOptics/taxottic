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
const MIN_JUMP_M = 1000; // chain shorter than 1 km = jitter / a short walk, not a drive
const MAX_JUMP_M = 250_000; // > 250 km between two fixes = data glitch, hard break
const MIN_DT_S = 120; // 2 min
const MAX_DT_S = 4 * 3600; // 4 h, beyond this we can't assume a single drive
/** A leg (consecutive fix pair) counts as "driving" when it moved at
 *  least this far... */
const LEG_MIN_M = 300;
/** ...at at least this implied speed (m/s). 2.5 ≈ 5.6 mph: above any
 *  walk, below the slowest crawl of city driving with 2-min fixes. */
const LEG_MIN_SPEED_MPS = 2.5;
/** A chain may bridge stationary legs (red lights, quick stops) up to
 *  this much accumulated pause before it is considered ended. */
const PAUSE_MAX_S = 360;
const NOTE =
  "Approximate drive, reconstructed from sparse GPS after a background-tracking gap. The trace may under-count road miles; verify before claiming.";

type RawPt = { id: string; ts: number; lat: number; lng: number };

export type TripWindow = { startTs: number; endTs: number };

/** Does the candidate jump window overlap any existing trip? Exported
 *  pure so the guard is unit-testable. */
export function overlapsExistingTrip(
  startTs: number,
  endTs: number,
  trips: readonly TripWindow[],
): boolean {
  return trips.some((t) => t.startTs <= endTs && t.endTs >= startTs);
}

/** Existing trip windows for the driver since `sinceIso` — the guard
 *  that stops recovery from re-creating a drive that already exists
 *  (fully-tracked or otherwise). Without it, the parked heartbeats
 *  that STRADDLE a finalized trip read as one long "jump" and recovery
 *  minted a straight-line duplicate right on top of the real route. */
async function fetchTripWindows(
  admin: SupabaseClient,
  userId: string,
  companyId: string,
  sinceIso: string,
): Promise<TripWindow[]> {
  const { data } = await admin
    .from("mileage_trips")
    .select("started_at, ended_at")
    .eq("driver_user_id", userId)
    .eq("company_id", companyId)
    .gte("ended_at", sinceIso);
  return (data ?? []).map((t) => ({
    startTs: Date.parse(t.started_at as string),
    endTs: Date.parse(t.ended_at as string),
  }));
}

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

export type ApproxChain = {
  /** Index range into the input points array, inclusive. */
  startIdx: number;
  endIdx: number;
  /** Sum of leg distances across the chain (the honest sparse-trace
   *  length — still an under-count of road miles, never an over-count). */
  meters: number;
};

/**
 * Group consecutive driving-like legs into chains, bridging short
 * pauses (red lights, quick stops). This replaces the old
 * endpoint-pair "jump" logic: a drive captured as sparse fixes every
 * couple of minutes now becomes ONE approximate trip whose polyline
 * follows every fix we actually have, instead of a straight line
 * between the first and last stop. Pure and exported for tests.
 */
export function buildApproxChains(pts: readonly RawPt[]): ApproxChain[] {
  const chains: ApproxChain[] = [];
  let start = -1; // index of chain's first point
  let lastDrivingEnd = -1; // index of the last point of the last driving leg
  let meters = 0;
  let pauseS = 0;

  const close = () => {
    if (start >= 0 && lastDrivingEnd > start) {
      const durS = (pts[lastDrivingEnd].ts - pts[start].ts) / 1000;
      if (meters >= MIN_JUMP_M && durS >= MIN_DT_S && durS <= MAX_DT_S) {
        chains.push({ startIdx: start, endIdx: lastDrivingEnd, meters });
      }
    }
    start = -1;
    lastDrivingEnd = -1;
    meters = 0;
    pauseS = 0;
  };

  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const m = haversineMeters(a, b);
    const dt = (b.ts - a.ts) / 1000;
    const hardBreak = m > MAX_JUMP_M || dt > MAX_DT_S || dt <= 0;
    const driving = !hardBreak && m >= LEG_MIN_M && m / dt >= LEG_MIN_SPEED_MPS;

    if (hardBreak) {
      close();
      continue;
    }
    if (driving) {
      if (start < 0) start = i - 1;
      // Include the distance covered across any bridged pause legs too
      // (they moved a little; it is real, if tiny, ground).
      meters += m;
      lastDrivingEnd = i;
      pauseS = 0;
    } else if (start >= 0) {
      pauseS += dt;
      if (pauseS > PAUSE_MAX_S) close();
      // else: hold — a following driving leg resumes the chain, and the
      // trailing pause is trimmed at close() via lastDrivingEnd.
    }
  }
  close();
  return chains;
}

/** How many approximate trips a recovery run would create (for the UI label). */
export async function countRecoverableApproxTrips(
  admin: SupabaseClient,
  userId: string,
  companyId: string,
  sinceIso: string,
): Promise<number> {
  const [pts, tripWindows] = await Promise.all([
    fetchUnconsumed(admin, userId, companyId, sinceIso),
    fetchTripWindows(admin, userId, companyId, sinceIso),
  ]);
  let n = 0;
  for (const c of buildApproxChains(pts)) {
    if (overlapsExistingTrip(pts[c.startIdx].ts, pts[c.endIdx].ts, tripWindows))
      continue;
    n++;
  }
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
  const [pts, tripWindows] = await Promise.all([
    fetchUnconsumed(admin, userId, companyId, sinceIso),
    fetchTripWindows(admin, userId, companyId, sinceIso),
  ]);
  if (pts.length < 2) return 0;

  let created = 0;
  for (const chain of buildApproxChains(pts)) {
    const a = pts[chain.startIdx];
    const b = pts[chain.endIdx];
    const meters = chain.meters;
    // A drive that already exists as a trip (fully tracked, manual, or a
    // prior recovery) must never be recovered again — that was the
    // straight-line-duplicate bug. The end-of-run sweep still consumes
    // these straddle points so they stop counting as recoverable.
    if (overlapsExistingTrip(a.ts, b.ts, tripWindows)) continue;

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
    // Attach EVERY fix in the chain so the map draws whatever shape we
    // actually captured (a sparse but real route), not a straight line
    // between the two stops. Chunked insert to stay under payload caps.
    const tracePoints = pts.slice(chain.startIdx, chain.endIdx + 1).map((pt) => ({
      trip_id: ins.id,
      captured_at: new Date(pt.ts).toISOString(),
      lat: pt.lat,
      lng: pt.lng,
    }));
    for (let j = 0; j < tracePoints.length; j += 500) {
      const { error: ptErr } = await admin
        .from("mileage_points")
        .insert(tracePoints.slice(j, j + 500));
      if (ptErr) {
        console.error("[reconstruct] trace insert failed", ptErr.message);
        break;
      }
    }
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
