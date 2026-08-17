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
/** Must stay in lockstep with DeviceProbeStage in lib/mileage/device-status.ts.
 *  A stage the client sends and this set omits is rejected to NULL by oneOf(),
 *  so new instrumentation would report exactly nothing while looking wired.
 *  lib/mileage/probe-stage-contract.test.ts asserts the two agree. */
const STAGE_VALUES = new Set([
  "start",
  "bridge",
  "bridge_win",
  "bridge_nat",
  "bridge_reg",
  "call",
  "done",
]);

/** Where the device-truth fields in this row came from: this
 *  heartbeat's live probe, the last successful foreground read, or
 *  nothing. Always read alongside device_status_age_s. */
const SOURCE_VALUES = new Set(["live", "cache", "none"]);

/** Outcomes of the car-signals probe. Allowlisted like the others so a
 *  client cannot write arbitrary text into a column that gets grouped on.
 *  "timeout" is the EXPECTED value until the JS-to-native call path is
 *  fixed, and it is a finding rather than a blank: it says the bridge did
 *  not answer, which is exactly what device truth has been saying 450
 *  times. See lib/mileage/car-signals.ts. */
const CAR_PROBE_VALUES = new Set([
  "ok",
  "unavailable",
  "null",
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
  /** Enum-or-null: an app build older than the field sends nothing, and
   *  NULL is the honest record of that. Unlike the probe outcome there
   *  is no useful "absent" bucket here. */
  const oneOf = (k: string, allowed: Set<string>) => {
    const v = str(k, 12);
    return v && allowed.has(v) ? v : null;
  };

  const reportedAt = new Date().toISOString();
  const payload = {
    driver_user_id: user.id,
    company_id: companyId,
    platform: str("platform"),
    app_version: str("appVersion"),
    // The JS bundle, as distinct from the native binary above. A WebView on
    // a remote url can run a bundle days older than its app version, so
    // without this a "the fix does not work" report is indistinguishable
    // from "that device never got the fix". Those want opposite responses.
    web_build: str("webBuild", 16),
    // Which DEVICE wrote this. The status row stays one per (driver,
    // company) because three readers use maybeSingle() or a
    // driver-keyed Map and would break on more; this only names the
    // writer. The append-only history below is where a per-device
    // timeline actually lives: group it by (driver_user_id, device_id).
    // Without this, two devices on one account are indistinguishable and
    // read as one device changing app_version.
    // Bounded like every other client string: an id we did not generate
    // is untrusted input, not a promise.
    device_id: str("deviceId", 64),
    // CAR CONNECTION (CarPlay / Android Auto / car Bluetooth / car audio).
    //
    // car_probe is stored FIRST-CLASS, not as an afterthought. The native
    // detection has existed on both platforms for some time and reported
    // nothing, because nothing called it and there was nowhere to put the
    // result. It rides the same JS-to-native call that has failed on 450 of
    // 450 device-truth heartbeats, so `timeout` here is a likely outcome and
    // is a FINDING rather than a blank. It also serves as an independent
    // second probe of whether that bridge direction works at all.
    car_probe: oneOf("carProbe", CAR_PROBE_VALUES),
    car_probe_ms: num("carProbeMs"),
    car_projection_type: str("carProjectionType", 32),
    car_projection_observed:
      typeof body.carProjectionObserved === "boolean"
        ? body.carProjectionObserved
        : null,
    car_connects: num("carConnects"),
    car_disconnects: num("carDisconnects"),
    car_bluetooth_adapter: str("carBluetoothAdapter", 16),
    car_pending_signals: num("carPendingSignals"),
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
    // THE VERDICT COLUMN. Everything around it is a measurement; this
    // says whether the capabilities we ship are actually alive.
    //
    // Free text on purpose, and generously sized. It carries names, not
    // a count ("dead=geofence_plugin,device_status_plugin"), because a
    // count tells you something is wrong and a name tells you what to
    // fix. Truncating it to a stage-style enum would defeat the point,
    // and the capability list is expected to grow.
    //
    // 200 chars holds every id we have several times over. If it ever
    // truncates, the LEADING ids survive, and summarizeForHeartbeat puts
    // dead ones first, so the most serious finding is the last thing
    // lost rather than the first.
    self_check: str("selfCheck", 200),
    exit_probe_ms: num("exitProbeMs"),
    exit_probe_stage: oneOf("exitProbeStage", STAGE_VALUES),
    // OS app-state truth (@capacitor/app appStateChange), not
    // document.visibilityState. Null = the device has not told us yet.
    probe_foreground:
      typeof body.probeForeground === "boolean" ? body.probeForeground : null,
    // visibilityState, recorded as the weaker cross-check only.
    probe_visibility: str("probeVisibility", 12),
    timer_lag_ms: num("timerLagMs"),
    // Non-null when a stop-then-start arm sequence began and never
    // finished, i.e. WE tore the background service down and never put it
    // back. Reported as epoch ms by the client; stored as a timestamp.
    // Distinguishes a self-inflicted outage from an OS kill, which are
    // identical from every other angle and want different fixes.
    arm_interrupted_at: (() => {
      const ms = num("armInterruptedAt");
      return ms == null ? null : new Date(ms).toISOString();
    })(),
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
    // Native-buffer drain provenance. See
    // supabase/migrations/20260817020000_heartbeat_native_drain.sql.
    // Anything other than 'start' is a drain that happened while the app
    // was already running, which is the only production evidence that
    // the buffer is no longer hostage to a cold start. Read the trigger
    // BEFORE the count: 0 points under a live trigger is a healthy
    // steady state, 0 points under no trigger at all is a dead drain.
    native_drain_trigger: str("nativeDrainTrigger", 16),
    native_drain_points: num("nativeDrainPoints"),
    // Whether the duplicate suppression is alive. See
    // supabase/migrations/20260818010000_heartbeat_drain_dedupe.sql.
    // Read these two TOGETHER and in this order: checked = 0 means the
    // mechanism had no opportunity and proves nothing, while checked > 0
    // with suppressed = 0 means both native buffers held fixes and the
    // check matched none of them, which is what an inert dedupe looks
    // like from the outside.
    native_drain_checked: num("nativeDrainChecked"),
    native_drain_suppressed: num("nativeDrainSuppressed"),
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
