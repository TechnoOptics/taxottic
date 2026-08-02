import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { parseSignalReport } from "@/lib/mileage/signals";

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

/**
 * How far a probe got before it stopped making progress
 * (lib/mileage/device-status.ts):
 *   start   nothing awaited yet
 *   bridge  inside await import("@capacitor/core")
 *   call    the native method was invoked and had not resolved
 *   done    the native method resolved
 * A timeout at "bridge" is a JS module-loading problem; a timeout at
 * "call" is the bridge round-trip or the native side. Different bugs,
 * different fixes, and the previous probe could not tell them apart.
 */
const STAGE_VALUES = new Set(["start", "bridge", "call", "done"]);

/** Where the device-truth fields in this row came from: this
 *  heartbeat's live probe, the last successful foreground read, or
 *  nothing. Always read alongside device_status_age_s. */
const SOURCE_VALUES = new Set(["live", "cache", "none"]);

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
  /** Enum-or-null: an app build older than the field sends nothing, and
   *  NULL is the honest record of that. Unlike the probe outcome there
   *  is no useful "absent" bucket here. */
  const oneOf = (k: string, allowed: Set<string>) => {
    const v = str(k, 12);
    return v && allowed.has(v) ? v : null;
  };

  // Signal availability, sanitised through the shared registry. An
  // unrecognised key is dropped and an unrecognised verdict becomes
  // "unknown": the one thing that must never happen is silence reading
  // as "available".
  const rawAvailability = (body as Record<string, unknown>).signalAvailability;
  const parsedSignals = parseSignalReport(
    { availability: rawAvailability, observations: [] },
    Date.now(),
  );
  const signalAvailability =
    Object.keys(parsedSignals.availability).length > 0
      ? parsedSignals.availability
      : null;
  const signalRejections = num("signalRejections");

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
    // Probe CONTEXT. The first probed heartbeat from production came
    // back device_probe = 'timeout', which rules out registration, a
    // missing binary and an empty OS answer, but does not say why the
    // call never returned. These five columns are what make that
    // readable from the data instead of argued from plausibility.
    //
    // Reading them together:
    //   device_probe='timeout' AND device_probe_ms ~= 3000 AND
    //   timer_lag_ms small        our timers ran on schedule, so the JS
    //                             thread was NOT throttled and the
    //                             native call genuinely did not answer.
    //   device_probe='timeout' AND device_probe_ms >> 3000 AND
    //   timer_lag_ms large        our timers were starved: the time box
    //                             itself fired late. Background
    //                             throttling.
    //   device_probe_stage='bridge'
    //                             it never reached the native call at
    //                             all; the dynamic import hung.
    //   probe_foreground=false vs true
    //                             does success track foreground? If
    //                             timeouts also occur with
    //                             probe_foreground=true, foregrounding
    //                             is not the variable.
    device_probe_ms: num("deviceProbeMs"),
    device_probe_stage: oneOf("deviceProbeStage", STAGE_VALUES),
    exit_probe_ms: num("exitProbeMs"),
    exit_probe_stage: oneOf("exitProbeStage", STAGE_VALUES),
    // OS app-state truth (@capacitor/app appStateChange), not
    // document.visibilityState. Null = the device has not told us yet.
    probe_foreground:
      typeof body.probeForeground === "boolean" ? body.probeForeground : null,
    // visibilityState, recorded as the weaker cross-check only.
    probe_visibility: str("probeVisibility", 12),
    timer_lag_ms: num("timerLagMs"),
    // Provenance of the five device-truth columns above.
    // device_status_age_s = 0 means this heartbeat's live probe
    // answered; a larger number is the age of the last successful
    // foreground read. Never read the truth columns without it.
    device_status_source: oneOf("deviceStatusSource", SOURCE_VALUES),
    device_status_age_s: num("deviceStatusAgeS"),
    // Learned-place geofence mesh (Android). See
    // supabase/migrations/20260731000001_mileage_learned_places.sql.
    // geofence_capture = 'blind_no_fix' is the one that matters: a
    // geofence exit started the location service and it received no
    // location, so the permission was granted but not usable. Stored
    // verbatim rather than collapsed into a boolean, because "why"
    // is the whole value.
    geofence_arm_state: str("geofenceArmState", 40),
    geofence_count: num("geofenceCount"),
    geofence_capture: str("geofenceCapture", 40),
    geofence_buffered_fixes: num("geofenceBufferedFixes"),
    // Which drive signals this device can actually read, and why not
    // when it cannot. Sanitised through the same registry the scorer
    // uses, so an unknown key or an unknown verdict cannot reach the
    // column, and an unreported signal reads as "unknown" rather than
    // as health. This is what the degraded-mode ladder runs on.
    signal_availability: signalAvailability,
    signal_rejections: signalRejections,
    // iOS CMMotionActivity grant, deliberately separate from the
    // pedometer flag above: without it the seven-day gap audit is inert,
    // and an inert audit looks exactly like a clean record.
    motion_activity_authorization: str("motionActivityAuthorization", 20),
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
