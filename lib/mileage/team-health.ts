import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  evaluateDriveTrackingHealth,
  type DriveHealthResult,
} from "@/lib/mileage/device-health";

export type DriverHealthRow = {
  userId: string;
  label: string;
  health: DriveHealthResult;
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

  // Toggle intent overlay (best-effort).
  const { data: statuses } = await admin
    .from("mileage_device_status")
    .select("driver_user_id, tracking_enabled")
    .eq("company_id", companyId)
    .in("driver_user_id", ids);
  const enabledById = new Map(
    (statuses ?? []).map((s) => [
      s.driver_user_id as string,
      s.tracking_enabled as boolean | null,
    ]),
  );

  return drivers.map((d) => ({
    userId: d.userId,
    label: d.label,
    health: evaluateDriveTrackingHealth({
      nowMs,
      lastUploadMs: lastUpload.get(d.userId) ?? null,
      lastMovementMs: lastMovement.get(d.userId) ?? null,
      trackingEnabled: enabledById.get(d.userId) ?? null,
    }),
  }));
}
