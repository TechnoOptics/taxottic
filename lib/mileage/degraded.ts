/**
 * The degraded-mode ladder.
 *
 * Pure. Turns the device truth we already collect (heartbeat fields,
 * geofence mesh state, signal availability) into a set of named,
 * user-facing degradation states.
 *
 * ── TWO RULES ───────────────────────────────────────────────────────
 *
 * 1. NOTHING DEGRADES SILENTLY. Every rung is recorded in `active`, even
 *    the ones that do not warrant a banner, so the diagnose page can
 *    always answer "what is this device not doing". This project's
 *    signature failure is code that reports healthy while doing nothing;
 *    an empty `active` list is a claim, and it has to be earned.
 *
 * 2. NOTHING HERE PUSHES. The `surface` union has no notification
 *    member, by construction. Drives were deliberately removed from the
 *    bell, the popup and the reminder cron because the owner asked to be
 *    nagged less. Health belongs on the page. Adding a push here means
 *    adding a case to a type that does not have one, which is the point.
 *
 * The rung numbers follow the architecture document's ladder so the two
 * can be read side by side. Higher is worse.
 */

import type { SignalAvailability, SignalKind, SignalPlatform } from "./signals";
import type { AndroidWakeOutcome } from "./signal-adapter";

export type LadderAction =
  | "location_settings"
  | "background_location"
  | "battery_optimization"
  | "oem_wizard"
  | "pair_car"
  | "manual_add";

/**
 * Where a rung is allowed to appear. There is deliberately no "push"
 * member: see rule 2 above.
 *
 * - `silent`  recorded, diagnose page only. A supported path, not a break.
 * - `page`    a line on the mileage page.
 * - `blocking` a banner the user cannot dismiss, because tracking is dead.
 */
export type LadderSurface = "silent" | "page" | "blocking";

export type DegradedRung = {
  /** 0 healthy, 7 worst. Mirrors the architecture document. */
  rung: number;
  /** Stable identifier for the UI and for logging. */
  id: string;
  headline: string;
  detail: string;
  action: LadderAction | null;
  surface: LadderSurface;
};

export type LocationAuthorization =
  | "always"
  | "whenInUse"
  | "denied"
  | "notDetermined";

export type MotionActivityAuthorization =
  | "authorized"
  | "denied"
  | "restricted"
  | "notDetermined";

export type LadderInput = {
  platform: SignalPlatform;
  /** Lower-cased handset manufacturer where known. */
  manufacturer?: string | null;
  /** The user's own toggle. Null means we could not read it. */
  trackingEnabled: boolean | null;
  locationAuthorization: LocationAuthorization | null;
  backgroundRefresh: boolean | null;
  batteryOptimized: boolean | null;
  /** `describeGeofenceHealth(...).status`, or null when unread. */
  geofenceStatus: "ok" | "unavailable" | "degraded" | "broken" | null;
  /** Server-side expected-wake accounting found a wake that never came. */
  expectedWakeMissed: boolean;
  /** iOS CMMotionActivity grant. The seven-day gap audit is inert
   *  without it, and an inert audit looks exactly like a clean record. */
  motionActivityAuthorization?: MotionActivityAuthorization | null;
  /** Android per-event wake results. Not a boolean: the difference
   *  between "started" and "blocked_no_background_permission" is the
   *  difference between the feature working and a drive being lost. */
  wakeOutcomes?: readonly AndroidWakeOutcome[];
  signalAvailability: Partial<Record<SignalKind, SignalAvailability>>;
};

export type LadderResult = {
  /** The worst active rung, or a synthetic rung 0 when all is well. */
  worst: DegradedRung;
  /** Every active rung, worst first. Empty only when genuinely healthy. */
  active: DegradedRung[];
  /**
   * Whether the tracking toggle may honestly present as ON.
   *
   * The bug that made a 21-hour blackout invisible was a toggle that
   * said ON while the system was dead. This is the single boolean the
   * UI should trust, never `trackingEnabled` on its own.
   */
  trackingTruthfullyOn: boolean;
};

const HEALTHY: DegradedRung = {
  rung: 0,
  id: "healthy",
  headline: "Automatic tracking is armed",
  detail: "All wake sources are registered and permissions are complete.",
  action: null,
  surface: "silent",
};

const CAR_PRESENCE_KINDS: readonly SignalKind[] = [
  "car_bluetooth_connected",
  "car_audio_route",
  "android_auto_connected",
];

function anyAvailable(
  availability: Partial<Record<SignalKind, SignalAvailability>>,
  kinds: readonly SignalKind[],
): boolean {
  return kinds.some((k) => availability[k] === "available");
}

export function evaluateDegradedLadder(input: LadderInput): LadderResult {
  const active: DegradedRung[] = [];
  const ios = input.platform === "ios";
  const android = input.platform === "android";

  // The user's own choice is not a degradation. An off toggle is off,
  // honestly and quietly, and none of the rungs below apply.
  if (input.trackingEnabled === false) {
    return { worst: HEALTHY, active: [], trackingTruthfullyOn: false };
  }

  // Above everything else. A car connect fired, the receiver ran, and
  // the missing background-location permission stopped it starting
  // capture. Unlike every other rung this one is not a worry about what
  // MIGHT go wrong: it is evidence that a real drive was already lost.
  // Pushed first so it wins the sort against the other rung-7 states.
  const wakeOutcomes = input.wakeOutcomes ?? [];
  if (wakeOutcomes.includes("blocked_no_background_permission")) {
    active.push({
      rung: 7,
      id: "wake_blocked_permission",
      headline: "A drive was detected and not recorded",
      detail:
        "Your car connected and Taxottic could not start tracking, because background location access is not granted. That drive was missed. Allow location access all the time to stop it happening again.",
      action: "background_location",
      surface: "blocking",
    });
  }

  if (wakeOutcomes.includes("blocked_service_start_denied")) {
    active.push({
      rung: 5,
      id: "wake_service_denied",
      headline: "Android refused to start tracking in the background",
      detail:
        "The system blocked the tracking service from starting when your car connected. This is usually battery optimisation or an OEM background restriction.",
      action: "battery_optimization",
      surface: "page",
    });
  }

  // Rung 7. No automatic tracking is possible at all.
  if (input.locationAuthorization === "denied") {
    active.push({
      rung: 7,
      id: "location_denied",
      headline: "Automatic tracking is off",
      detail:
        "Location access is denied, so no drive can be recorded automatically. Add drives manually until access is restored.",
      action: "manual_add",
      surface: "blocking",
    });
  }

  // Rung 6. An expected wake did not arrive. Samsung's sleeping-apps
  // state has no API, so this inference is the only way it is ever seen.
  if (input.expectedWakeMissed) {
    active.push({
      rung: 6,
      id: "expected_wake_missed",
      headline: "Tracking was asleep for part of the day",
      detail:
        "A drive we expected to see never arrived. Check the gap and add anything that is missing.",
      action: "manual_add",
      surface: "page",
    });
  }

  // Rung 5. Android power management. We cannot fix this from inside the
  // app, so the only honest move is to say so and hand over the steps.
  if (android && input.batteryOptimized !== false) {
    const samsung = (input.manufacturer ?? "").toLowerCase() === "samsung";
    active.push({
      rung: 5,
      id: "battery_optimized",
      headline: "Android power saving can stop tracking",
      detail: samsung
        ? "Sleeping apps: Samsung restricts background services for apps it thinks are unused, and re-enables the restriction after system updates. Remove Taxottic from Sleeping apps and from Deep sleeping apps."
        : "Battery optimisation can stop the tracker being restarted in the background. Allow unrestricted background use for Taxottic.",
      action: samsung ? "oem_wizard" : "battery_optimization",
      surface: "page",
    });
  }

  // Rung 4. iOS Background App Refresh. SLC and region monitoring both
  // go silent with no error at all when this is off.
  if (ios && input.backgroundRefresh !== true) {
    active.push({
      rung: 4,
      id: "background_refresh_off",
      headline: "Background App Refresh is off",
      detail:
        "With Background App Refresh off, iOS will not restart Taxottic for a location event, and it reports no error when that happens. Turn it on in Settings, General, Background App Refresh.",
      action: "location_settings",
      surface: "blocking",
    });
  }

  // Rung 3. iOS downgraded from Always. Native revival is disarmed.
  if (ios && input.locationAuthorization === "whenInUse") {
    active.push({
      rung: 3,
      id: "location_when_in_use",
      headline: "Location is limited to while using the app",
      detail:
        "Drives can only be recorded while Taxottic is open. Set location access to Always to record them in the background.",
      action: "location_settings",
      surface: "blocking",
    });
  }

  // Rung 2. Signals refused by platform policy. A supported path, not a
  // break: recorded so it is inspectable, not surfaced so it is not nagging.
  const policyBlocked = (
    Object.entries(input.signalAvailability) as [
      SignalKind,
      SignalAvailability,
    ][]
  ).filter(([, v]) => v === "policy_blocked" || v === "unsupported");
  if (policyBlocked.length > 0) {
    active.push({
      rung: 2,
      id: "signals_policy_blocked",
      headline: "Some drive signals are unavailable on this device",
      detail: `Not readable here: ${policyBlocked
        .map(([k]) => k)
        .join(", ")}. Detection uses the remaining signals.`,
      action: null,
      surface: "silent",
    });
  }

  // Rung 1. We are running, but with less evidence than we would like.
  const carSignal = anyAvailable(input.signalAvailability, CAR_PRESENCE_KINDS);
  const anySignal = Object.values(input.signalAvailability).some(
    (v) => v === "available",
  );
  if (!anySignal) {
    active.push({
      rung: 1,
      id: "no_vehicle_signals",
      headline: "Running without vehicle signals",
      detail:
        "No car or motion signal is being reported, so drives are detected from movement alone and more of them will need review.",
      action: null,
      surface: "page",
    });
  } else if (!carSignal) {
    active.push({
      rung: 1,
      id: "no_car_signal",
      headline: "No car connection available",
      detail:
        "Pairing your phone to your car's Bluetooth lets drives start sooner and confirms more of them automatically.",
      action: "pair_car",
      surface: "page",
    });
  }

  // iOS-only. The gap audit never prompts, so an ungranted Motion
  // permission leaves it permanently inert. Saying nothing would present
  // "no gaps found" when the truth is "we never looked".
  if (
    ios &&
    input.motionActivityAuthorization != null &&
    input.motionActivityAuthorization !== "authorized"
  ) {
    active.push({
      rung: 1,
      id: "gap_audit_unavailable",
      headline: "Missed drives cannot be detected",
      detail:
        "Motion access has not been granted, so Taxottic cannot check whether a drive was missed while it was asleep. Gaps will not be reported until it is.",
      action: "location_settings",
      surface: "page",
    });
  }

  // The wake mesh itself. Permissions can look perfect while no region
  // is actually registered, which is the failure the mesh health check
  // was built for.
  if (input.geofenceStatus === "broken" || input.geofenceStatus === null) {
    active.push({
      rung: 5,
      id: "wake_mesh_broken",
      headline: "Automatic restart is not armed",
      detail:
        input.geofenceStatus === null
          ? "This app build has not reported whether its restart mesh is armed. Open the app to re-arm it."
          : "The geofence mesh that restarts tracking is not working, so a drive after the app is closed may be missed.",
      action: "background_location",
      surface: "page",
    });
  } else if (input.geofenceStatus === "degraded") {
    active.push({
      rung: 1,
      id: "wake_mesh_degraded",
      headline: "Automatic restart is partly armed",
      detail:
        "Some restart points are missing. Drives from unfamiliar places may start late.",
      action: null,
      surface: "page",
    });
  }

  // An unread permission is not a granted one. An app build older than
  // these fields reports null, and reading null as health is exactly how
  // silent failure survives.
  if (input.locationAuthorization == null) {
    active.push({
      rung: 1,
      id: "device_state_unknown",
      headline: "This device has not reported its permissions",
      detail:
        "Taxottic cannot confirm that background tracking is allowed here. Open the app to refresh it.",
      action: null,
      surface: "page",
    });
  }

  active.sort((a, b) => b.rung - a.rung);

  const blocked = active.some((d) => d.surface === "blocking");
  const meshBroken = active.some((d) => d.id === "wake_mesh_broken");

  return {
    worst: active[0] ?? HEALTHY,
    active,
    trackingTruthfullyOn:
      input.trackingEnabled === true && !blocked && !meshBroken,
  };
}
