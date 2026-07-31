import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Device-state heartbeat (reliability plan, workstream C). The tracker
 * reports its OWN view of health — toggle state, buffer depth, seconds
 * since the last native callback, flush failure streak, and (once the
 * native DeviceStatus plugin ships) the actual location-authorization
 * level. This turns "the server infers death from hours of GPS silence"
 * into "the device says the toggle is ON but the watcher is dead",
 * which the finalize cron converts into an immediate push instead of a
 * 3-hour-floor one.
 *
 * Every heartbeat is written twice: an upsert into
 * mileage_device_status (latest state, what the finalize cron and the
 * manager health view read) and an append into
 * mileage_device_heartbeats (history, what makes a past blackout
 * diagnosable). See supabase/migrations/20260731000000_mileage_device_heartbeats.sql.
 */

/** Minimum spacing between HISTORY rows. The client heartbeats every
 *  ~5 min while tracking, plus on start/stop/resume; anything tighter
 *  than this is a resume storm or a broken client, and adds no
 *  diagnostic value. Toggle flips bypass it. */
const MIN_HISTORY_GAP_MS = 30_000;

/**
 * Accepted native-probe outcomes (lib/mileage/device-status.ts):
 *   ok          the plugin answered with data
 *   null        the plugin answered, nothing to report
 *   unavailable no bridge to ask (web, or registerPlugin failed)
 *   error       the bridge exists but the call rejected
 *   timeout     the call never came back
 * Anything else, including a missing field (an app build older than
 * this), records as "absent".
 */
const PROBE_VALUES = new Set([
  "ok",
  "null",
  "unavailable",
  "error",
  "timeout",
]);

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }
  const companyId = typeof body.companyId === "string" ? body.companyId : "";
  if (!companyId) {
    return NextResponse.json({ error: "missing_company" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data: membership } = await admin
    .from("company_members")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!membership) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const str = (k: string, max = 40) =>
    typeof body[k] === "string" ? (body[k] as string).slice(0, max) : null;
  const num = (k: string) =>
    typeof body[k] === "number" && Number.isFinite(body[k])
      ? Math.max(0, Math.round(body[k] as number))
      : null;
  const probe = (k: string) => {
    const v = str(k, 12);
    return v && PROBE_VALUES.has(v) ? v : "absent";
  };

  const reportedAt = new Date().toISOString();
  const payload = {
    driver_user_id: user.id,
    company_id: companyId,
    platform: str("platform"),
    app_version: str("appVersion"),
    tracking_enabled: body.trackingEnabled === true,
    buffer_size: num("bufferSize") ?? 0,
    last_cb_age_s: num("lastCbAgeS"),
    fail_streak: num("failStreak") ?? 0,
    location_authorization: str("locationAuthorization", 20),
    precise_location:
      typeof body.preciseLocation === "boolean" ? body.preciseLocation : null,
    battery_optimized:
      typeof body.batteryOptimized === "boolean" ? body.batteryOptimized : null,
    low_power_mode:
      typeof body.lowPowerMode === "boolean" ? body.lowPowerMode : null,
    background_refresh:
      typeof body.backgroundRefresh === "boolean"
        ? body.backgroundRefresh
        : null,
    last_exit_reason: str("exitReason", 60),
    last_exit_at:
      typeof body.exitAtMs === "number" && Number.isFinite(body.exitAtMs)
        ? new Date(body.exitAtMs).toISOString()
        : null,
    last_exit_detail:
      body.exitDetail && typeof body.exitDetail === "object"
        ? body.exitDetail
        : null,
    // Did the native bridge answer at all? Without this a NULL
    // location_authorization cannot be told apart from a dead bridge.
    device_probe: probe("deviceProbe"),
    exit_probe: probe("exitProbe"),
    reported_at: reportedAt,
  };

  // Read the current row BEFORE overwriting it: it is both the throttle
  // reference for the history append and the only way to notice a
  // toggle flip that happened inside the throttle window.
  const { data: prev } = await admin
    .from("mileage_device_status")
    .select("reported_at, tracking_enabled")
    .eq("driver_user_id", user.id)
    .eq("company_id", companyId)
    .maybeSingle();

  const { error } = await admin
    .from("mileage_device_status")
    .upsert(payload, { onConflict: "driver_user_id,company_id" });
  if (error) {
    console.error("[heartbeat] upsert failed", error.message);
    return NextResponse.json({ error: "store_failed" }, { status: 500 });
  }

  // Append-only history (mileage_device_heartbeats). The latest-state
  // row above is overwritten by every heartbeat, so a blackout erases
  // its own evidence the moment the driver reopens the app. History is
  // what makes "when did this device go quiet, and what was it saying
  // either side of the gap" answerable after the fact.
  //
  // Best-effort by design: a failed append must never fail the
  // heartbeat, because the heartbeat also drives the finalize cron's
  // stall escalation. Throttled to one row per MIN_HISTORY_GAP_MS so a
  // looping client cannot flood the table, but a tracking_enabled flip
  // always lands (start/stop transitions are the highest-value rows and
  // are rare).
  const prevAtMs = prev?.reported_at ? Date.parse(prev.reported_at as string) : null;
  const toggleFlipped =
    prev != null && (prev.tracking_enabled as boolean) !== payload.tracking_enabled;
  const throttled =
    !toggleFlipped &&
    prevAtMs != null &&
    Date.now() - prevAtMs < MIN_HISTORY_GAP_MS;
  if (!throttled) {
    const { error: histErr } = await admin
      .from("mileage_device_heartbeats")
      .insert(payload);
    if (histErr) {
      console.error("[heartbeat] history append failed", histErr.message);
    }
  }

  return NextResponse.json({ ok: true });
}
