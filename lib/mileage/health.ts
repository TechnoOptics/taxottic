import type { SupabaseClient } from "@supabase/supabase-js";
import { haversineMeters } from "./segmentation";

// Tracking-health detector.
//
// A phone whose background location has been downgraded to "While Using"
// (or has battery optimisation killing it) keeps logging points while the
// app is FOREGROUND + parked, then gets woken by the OS at a new location -
// so the staging pool fills with stationary clusters separated by big
// "teleport" jumps, with almost no in-between driving samples. Segmentation
// (correctly) makes no trips from that, so the user silently loses miles.
//
// This detects that exact signature from the recent raw pool so the UI can
// warn the user to set Location to Always, instead of failing silently.

export type TrackingHealth = {
  status: "ok" | "degraded" | "idle";
  pointsRecent: number;
  movingPairs: number;
  bigJumps: number;
  reason: string | null;
};

const RECENT_DAYS = 3;
/** Consecutive samples this far apart, close in time = real driving trace. */
const MOVING_MIN_M = 150;
const MOVING_MAX_M = 1500;
const MOVING_MAX_DT_S = 90;
/** A relocation with no trace in between = a drive the phone slept through. */
const JUMP_MIN_M = 1500;
const JUMP_MIN_DT_S = 120;
const JUMP_MAX_DT_S = 4 * 3600;

export async function assessMileageTrackingHealth(
  admin: SupabaseClient,
  userId: string,
  companyId: string,
): Promise<TrackingHealth> {
  const since = new Date(Date.now() - RECENT_DAYS * 86_400_000).toISOString();
  const { data } = await admin
    .from("mileage_points_raw")
    .select("captured_at, lat, lng")
    .eq("driver_user_id", userId)
    .eq("company_id", companyId)
    .gte("captured_at", since)
    .order("captured_at", { ascending: true })
    .limit(5000);

  const pts = (data ?? []).map((r) => ({
    ts: Date.parse(r.captured_at as string),
    lat: r.lat as number,
    lng: r.lng as number,
  }));
  if (pts.length < 30) {
    return { status: "idle", pointsRecent: pts.length, movingPairs: 0, bigJumps: 0, reason: null };
  }

  let movingPairs = 0;
  let bigJumps = 0;
  for (let i = 1; i < pts.length; i++) {
    const m = haversineMeters(pts[i - 1], pts[i]);
    const dt = (pts[i].ts - pts[i - 1].ts) / 1000;
    if (m >= MOVING_MIN_M && m <= MOVING_MAX_M && dt <= MOVING_MAX_DT_S) movingPairs++;
    if (m > JUMP_MIN_M && dt >= JUMP_MIN_DT_S && dt <= JUMP_MAX_DT_S) bigJumps++;
  }

  // Phone is clearly active (lots of points) but there's no real driving
  // trace, and there ARE teleport jumps → background capture is degraded.
  const degraded = movingPairs <= 3 && bigJumps >= 1;
  return {
    status: degraded ? "degraded" : "ok",
    pointsRecent: pts.length,
    movingPairs,
    bigJumps,
    reason: degraded
      ? "Your phone is logging where you stop but not the driving in between, background location is likely set to “While Using” instead of “Always.”"
      : null,
  };
}
