import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateDriveTrackingHealth,
  type DriveHealthResult,
} from "@/lib/mileage/device-health";
import { evaluateDeviceCause, type DeviceCause } from "@/lib/mileage/device-cause";

export type DriverHealthRow = {
  userId: string;
  label: string;
  health: DriveHealthResult;
  /** What the phone's own status row says is wrong, or null when the
   *  row does not know. See device-cause.ts. */
  cause: DeviceCause | null;
  /** "ios" | "android" | "web" as the heartbeat reports it, so the
   *  cause can name the right Settings path. */
  platform: string | null;
};

/**
 * Compute each driver's drive-tracking health from raw uploads.
 *
 * Build-independent by construction: last-upload and last-movement come
 * from mileage_points_raw, which every build writes, so this reports
 * truthfully even for a phone on an ancient build that never sends the
 * newer heartbeat fields. The toggle intent is a best-effort overlay
 * from mileage_device_status; absent, the driver is still watched.
 *
 * One aggregate query per signal (not per driver) so this stays cheap
 * for the manager page even with a large team.
 */
export async function loadTeamTrackingHealth(
  admin: SupabaseClient,
  companyId: string,
  drivers: { userId: string; label: string }[],
  nowMs: number,
): Promise<DriverHealthRow[]> {
  if (drivers.length === 0) return [];
  const ids = drivers.map((d) => d.userId);

  // Latest upload + latest real-movement upload per driver. PostgREST
  // can't GROUP BY, so pull the recent points once and reduce in JS.
  // Bounded to the parked window: anything older than that is already
  // "parked" regardless of the exact timestamp, so we don't need it.
  const sinceIso = new Date(nowMs - 50 * 60 * 60_000).toISOString();
  const lastUpload = new Map<string, number>();
  const lastMovement = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; from < 20_000; from += PAGE) {
    const { data, error } = await admin
      .from("mileage_points_raw")
      .select("driver_user_id, created_at, speed_mps")
      .eq("company_id", companyId)
      .in("driver_user_id", ids)
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error || !data || data.length === 0) break;
    for (const r of data) {
      const d = r.driver_user_id as string;
      const t = Date.parse(r.created_at as string);
      if (!lastUpload.has(d)) lastUpload.set(d, t);
      if (
        !lastMovement.has(d) &&
        Number((r as { speed_mps: number | null }).speed_mps ?? 0) >= 2.5
      ) {
        lastMovement.set(d, t);
      }
    }
    if (data.length < PAGE) break;
  }

  // For drivers with no upload inside the window, fall back to their
  // all-time latest so "silent 9d" reads right instead of "never".
  const missing = ids.filter((id) => !lastUpload.has(id));
  if (missing.length) {
    for (const id of missing) {
      const { data } = await admin
        .from("mileage_points_raw")
        .select("created_at")
        .eq("company_id", companyId)
        .eq("driver_user_id", id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.created_at) lastUpload.set(id, Date.parse(data.created_at as string));
    }
  }

  // Toggle intent overlay (best-effort), plus the device-truth columns
  // the phone wrote about itself. Those name the cause when there is
  // one: a row that says location_authorization = 'whenInUse' knows why
  // it is silent, and the manager should be told that rather than a
  // guess.
  type StatusRow = {
    driver_user_id: string;
    tracking_enabled: boolean | null;
    background_refresh: boolean | null;
    platform: string | null;
    location_authorization: string | null;
    low_power_mode: boolean | null;
    battery_optimized: boolean | null;
  };
  const { data: statuses } = await admin
    .from("mileage_device_status")
    .select("driver_user_id, tracking_enabled, background_refresh, platform, location_authorization, low_power_mode, battery_optimized")
    .eq("company_id", companyId)
    .in("driver_user_id", ids);
  const statusById = new Map(
    ((statuses ?? []) as StatusRow[]).map((s) => [s.driver_user_id, s]),
  );

  return drivers.map((d) => {
    const s = statusById.get(d.userId);
    return {
      userId: d.userId,
      label: d.label,
      health: evaluateDriveTrackingHealth({
        nowMs,
        lastUploadMs: lastUpload.get(d.userId) ?? null,
        lastMovementMs: lastMovement.get(d.userId) ?? null,
        trackingEnabled: s?.tracking_enabled ?? null,
        backgroundRefresh: s?.background_refresh ?? null,
      }),
      cause: s
        ? evaluateDeviceCause({
            platform: s.platform ?? null,
            locationAuthorization: s.location_authorization ?? null,
            backgroundRefresh: s.background_refresh ?? null,
            lowPowerMode: s.low_power_mode ?? null,
            batteryOptimized: s.battery_optimized ?? null,
            trackingEnabled: s.tracking_enabled ?? null,
          })
        : null,
      platform: s?.platform ?? null,
    };
  });
}
