/**
 * The multi-signal contract: what a signal is, which platform can produce
 * it, and — the load-bearing part — whether it is allowed to START a trip.
 *
 * Pure. No platform imports, no Capacitor, no Supabase, no React. Every
 * rule in here is unit-testable without a device, which is the point:
 * two previous efforts on this pipeline shipped background-execution
 * assumptions that were simply wrong, and nothing caught them.
 *
 * ── THE RULE THIS FILE EXISTS TO ENFORCE ────────────────────────────
 *
 * Signals split into two tiers and they are NOT interchangeable.
 *
 *   WAKE SOURCES are the small set of events the OS will actually start
 *   our process for. On Android that is geofence transitions (delivered
 *   to a BroadcastReceiver via PendingIntent) and process-restart events.
 *   On iOS it is significant-location-change, region monitoring and
 *   visits, and NOTHING else, because a terminated app runs no code.
 *
 *   CONFIRMATION SIGNALS are everything evaluated once we are already
 *   awake. They raise or lower confidence. They cannot start anything.
 *
 * A confirmation signal must never be load-bearing for starting a trip.
 * Car Bluetooth is the strongest evidence of a drive available to us and
 * on iOS it cannot wake us at all: classic A2DP/HFP car audio is
 * invisible to CoreBluetooth, and the CoreBluetooth restoration path
 * would need a `bluetooth-central` background mode we do not declare.
 * On Android, `ACTION_ACL_CONNECTED` is an implicit broadcast and
 * Android 8+ blocks most implicit broadcasts from manifest-declared
 * receivers; whether ACL is on the exemption list is UNPROVEN on device.
 * So on BOTH platforms car presence is confirmation-tier here. That is
 * how "the most reliable signal" avoids becoming a design that never
 * fires. `ANDROID_ACL_WAKE_PROVEN` below is the single switch that may
 * promote it, and it may only be flipped by a device test.
 *
 * The registry is the only place tier is decided, and
 * `wakeSourcesFor()` derives the wake list from it, so a new signal
 * cannot quietly acquire wake powers by being added in two places.
 */

export type SignalPlatform = "ios" | "android" | "web";

export type SignalTier = "wake" | "confirmation";

/**
 * Where a signal comes from. `device` arrives over the wire from a native
 * producer; `derived` is computed server-side from the track we already
 * hold. Counter-evidence is always `derived`: a device that could post
 * "this was a walk" could suppress its own owner's drives.
 */
export type SignalOrigin = "device" | "derived";

/** When a signal can be read. The seven-day motion history is only
 *  queryable after the fact, so it can score a finished trip but can
 *  never influence a live start decision. */
export type SignalAvailableAt = "live" | "retrospective" | "both";

/**
 * Correlated signals must not stack at full weight. Sustained vehicle
 * speed and a road-snapped track are the same physical fact observed
 * twice; summing them lets weak, correlated evidence outvote a decisive
 * signal, which is the exact failure a flat count-of-three has.
 */
export type CorrelationGroup =
  | "vehicle_presence"
  | "vehicle_motion"
  | "location"
  | "ambient"
  | "counter"
  | "none";

export type SignalKind =
  // Wake sources.
  | "geofence_exit"
  | "geofence_enter"
  | "significant_location_change"
  | "visit_departure"
  | "boot_completed"
  | "app_opened"
  // Device confirmation signals.
  | "car_bluetooth_connected"
  | "car_audio_route"
  | "android_auto_connected"
  | "charging_connected"
  | "motion_activity_automotive"
  | "motion_history_automotive"
  | "sustained_vehicle_speed"
  | "screen_off_motion"
  // Server-derived signals.
  | "road_snapped"
  | "walking_track"
  | "low_displacement"
  | "confined_to_parking_polygon";

/**
 * Why a signal is not contributing. Recorded and surfaced, never
 * absorbed: this project's signature failure is code that reports
 * healthy while doing nothing.
 *
 * `unknown` is the default for a signal the device said nothing about,
 * which is what an app build older than the signal looks like. It must
 * never be read as `available`.
 */
export type SignalAvailability =
  | "available"
  | "unsupported"
  | "permission_denied"
  | "permission_not_requested"
  | "hardware_off"
  | "policy_blocked"
  | "unknown";

const AVAILABILITY_VALUES: readonly SignalAvailability[] = [
  "available",
  "unsupported",
  "permission_denied",
  "permission_not_requested",
  "hardware_off",
  "policy_blocked",
  "unknown",
];

/**
 * One observation of one signal.
 *
 * Deliberately an INTERVAL, not an instant. A car Bluetooth connection is
 * a level, not an edge: while it still holds it is present-tense evidence
 * and must not age. An edge signal (a geofence crossing) sets
 * `lastSeenAtMs === startedAtMs` and ages from there. One decay rule
 * covers both: evidence ages from `endedAtMs ?? lastSeenAtMs`.
 *
 * `lastSeenAtMs` is when the producer last CONFIRMED the signal held, not
 * when it uploaded. A producer that goes quiet therefore lets its own
 * evidence decay, which is the honest behaviour.
 */
export type SignalObservation = {
  kind: SignalKind;
  platform: SignalPlatform;
  /** Epoch ms the signal began. */
  startedAtMs: number;
  /** Epoch ms the producer last confirmed it still held. */
  lastSeenAtMs: number;
  /** Epoch ms it was observed to end; null while still asserted. */
  endedAtMs: number | null;
  /**
   * How strongly the signal held, 0 to 1, default 1.
   *
   * Some signals are graded, not binary: 60 seconds above 7 m/s and 40
   * minutes of motorway are the same KIND of evidence at very different
   * strengths, and a single weight for both either overrates the burst
   * or underrates the drive. Producers that have nothing to grade omit
   * it.
   */
  strength?: number;
  /**
   * How the producer came to know. Load-bearing, and deliberately not
   * collapsed: `"event"` means a transition actually fired, `"poll"`
   * means we looked at that instant and found the signal true. A poll at
   * 08:14 is NOT evidence that the car connected at 08:14, and letting a
   * stale connection read as a fresh one is exactly how a parked car
   * becomes a phantom trip.
   */
  source?: SignalObservationSource;
  detail: string | null;
};

export type SignalObservationSource =
  | "event"
  | "poll"
  | "live"
  | "history"
  | "audit"
  | "derived";

export type SignalRejectionReason =
  | "unknown_kind"
  | "unsupported_on_platform"
  | "not_device_reportable"
  | "future_timestamp"
  | "malformed"
  | "too_many_observations";

export type SignalRejection = {
  kind: string | null;
  reason: SignalRejectionReason;
};

export type SignalReport = {
  observations: SignalObservation[];
  availability: Partial<Record<SignalKind, SignalAvailability>>;
  /** Every input we would not accept, with the reason. Persisted and
   *  shown, so a producer emitting garbage is visible rather than
   *  silently ignored. */
  rejected: SignalRejection[];
};

export type SignalDefinition = {
  kind: SignalKind;
  /** Tier per platform. `null` means the platform cannot produce it. */
  tier: { ios: SignalTier | null; android: SignalTier | null };
  /** Evidence at zero age, on a 0-100 scale. Negative is counter-evidence. */
  weight: number;
  /** Evidence halves every this many ms of age. */
  halfLifeMs: number;
  group: CorrelationGroup;
  origin: SignalOrigin;
  availableAt: SignalAvailableAt;
  /** Plain-language sentence used when this signal is what is MISSING. */
  absentReason: string | null;
};

/**
 * PROVEN, on Android only.
 *
 * `ACTION_ACL_CONNECTED` was in question because Android 8+ blocks most
 * implicit broadcasts from manifest-declared receivers. The Android
 * producer settled it on a real handset: the receiver starts a dead
 * process, and the outcome is reported per event as `wakeOutcome`
 * (`started` / `already_running` / `blocked_*`), so the claim keeps
 * proving itself in the field rather than resting on one test.
 *
 * This constant governs ANDROID ONLY and must never be generalised. On
 * iOS classic car audio is invisible to CoreBluetooth, the audio-route
 * notification does not survive backgrounding, and making it survive
 * would need an always-active audio session plus an `audio` background
 * mode in an app that plays no audio, which is an App Review rejection.
 * The platforms are genuinely asymmetric and the registry says so.
 */
export const ANDROID_ACL_WAKE_PROVEN = true;

const MIN = 60_000;

/** Hard cap on observations accepted from one payload. A native producer
 *  looping on a broadcast must not be able to fill the table. */
export const MAX_OBSERVATIONS_PER_REPORT = 64;

export const SIGNAL_REGISTRY: Readonly<Record<SignalKind, SignalDefinition>> = {
  // ── Wake sources ────────────────────────────────────────────────────
  //
  // A wake source may also carry evidence weight. Tier decides whether it
  // can START a trip; weight decides how much it counts once it has. A
  // learned-place geofence exit is both: it wakes us, and leaving your own
  // driveway is real evidence a drive began.
  geofence_exit: {
    kind: "geofence_exit",
    tier: { ios: "wake", android: "wake" },
    weight: 30,
    halfLifeMs: 15 * MIN,
    group: "location",
    origin: "device",
    availableAt: "both",
    absentReason: "Did not start from a place we recognise",
  },
  geofence_enter: {
    // Arrival wakes us and is a stop hint. It is not evidence a drive
    // STARTED, so it is deliberately weightless.
    kind: "geofence_enter",
    tier: { ios: "wake", android: "wake" },
    weight: 0,
    halfLifeMs: 15 * MIN,
    group: "none",
    origin: "device",
    availableAt: "both",
    absentReason: null,
  },
  significant_location_change: {
    // Fires only after roughly 500 m of travel, so by the time it lands
    // something moved. Weak on its own because walking triggers it too.
    kind: "significant_location_change",
    tier: { ios: "wake", android: "wake" },
    weight: 10,
    halfLifeMs: 15 * MIN,
    group: "location",
    origin: "device",
    availableAt: "both",
    absentReason: null,
  },
  visit_departure: {
    // iOS-only, system-computed and free, but often reported well after
    // the fact. Wake-capable, weak as evidence of *when*.
    kind: "visit_departure",
    tier: { ios: "wake", android: null },
    weight: 10,
    halfLifeMs: 30 * MIN,
    group: "location",
    origin: "device",
    availableAt: "both",
    absentReason: null,
  },
  boot_completed: {
    kind: "boot_completed",
    tier: { ios: null, android: "wake" },
    weight: 0,
    halfLifeMs: 15 * MIN,
    group: "none",
    origin: "device",
    availableAt: "both",
    absentReason: null,
  },
  app_opened: {
    // The user opening the app re-arms the whole mesh. It is a legitimate
    // wake, and worth exactly nothing as evidence of driving.
    kind: "app_opened",
    tier: { ios: "wake", android: "wake" },
    weight: 0,
    halfLifeMs: 15 * MIN,
    group: "none",
    origin: "device",
    availableAt: "both",
    absentReason: null,
  },

  // ── Device confirmation signals ─────────────────────────────────────
  car_bluetooth_connected: {
    // Strongest single piece of evidence we can get. Confirmation-tier on
    // Android until ACL broadcast delivery is proven on device.
    kind: "car_bluetooth_connected",
    tier: {
      ios: null,
      android: ANDROID_ACL_WAKE_PROVEN ? "wake" : "confirmation",
    },
    weight: 45,
    halfLifeMs: 10 * MIN,
    group: "vehicle_presence",
    origin: "device",
    availableAt: "live",
    absentReason: "No car connection detected",
  },
  car_audio_route: {
    // The iOS equivalent: AVAudioSession.currentRoute naming a car port.
    // Readable while awake, and NOT a wake source (see file header).
    kind: "car_audio_route",
    tier: { ios: "confirmation", android: null },
    weight: 45,
    halfLifeMs: 10 * MIN,
    group: "vehicle_presence",
    origin: "device",
    availableAt: "live",
    absentReason: "No car connection detected",
  },
  android_auto_connected: {
    // Stronger than plain Bluetooth (you do not get a projection session
    // walking past a parked car) but same physical fact, same group.
    kind: "android_auto_connected",
    tier: { ios: null, android: "confirmation" },
    weight: 45,
    halfLifeMs: 10 * MIN,
    group: "vehicle_presence",
    origin: "device",
    availableAt: "live",
    absentReason: null,
  },
  sustained_vehicle_speed: {
    // >= ~8 m/s held for >= 60 s, graded by how long it held.
    //
    // DELIBERATE DISAGREEMENT with the design doc, which puts this at 40,
    // below car Bluetooth at 45. For DETECTING that a drive happened,
    // sustained road speed over many miles is the stronger evidence: its
    // false positives (passenger, bus, train) are all "a vehicle moved",
    // which is a classification error, not a detection error. Bluetooth
    // proves proximity to a car, and a parked car with the accessories on
    // holds the link all evening. Bluetooth is the better CLASSIFIER
    // (whose car, driver or passenger); speed is the better DETECTOR, and
    // this engine detects. It also needs no permission we do not already
    // hold and is computable server-side from points we already store,
    // which is what stops the whole engine being vacuous on day one.
    kind: "sustained_vehicle_speed",
    tier: { ios: "confirmation", android: "confirmation" },
    weight: 50,
    halfLifeMs: 5 * MIN,
    group: "vehicle_motion",
    origin: "device",
    availableAt: "both",
    absentReason: "Speeds were unusually low for driving",
  },
  motion_activity_automotive: {
    // Apple's own classifier. Real evidence, but laggy and it confuses
    // bus and train, so it sits below sustained speed.
    kind: "motion_activity_automotive",
    tier: { ios: "confirmation", android: null },
    weight: 30,
    halfLifeMs: 5 * MIN,
    group: "vehicle_motion",
    origin: "device",
    availableAt: "live",
    absentReason: null,
  },
  motion_history_automotive: {
    // CMMotionActivityManager's seven-day history. Cannot wake us and
    // cannot be queried usefully in the moment, but it is excellent
    // retrospective evidence when scoring a finished trip.
    kind: "motion_history_automotive",
    tier: { ios: "confirmation", android: null },
    weight: 25,
    halfLifeMs: 60 * MIN,
    group: "vehicle_motion",
    origin: "device",
    availableAt: "retrospective",
    absentReason: null,
  },
  charging_connected: {
    // TripLog ships this as "Plug-N-Go", so it is a proven-enough idea,
    // but a desk charger looks identical. Weak, and ambient by design.
    kind: "charging_connected",
    tier: { ios: "confirmation", android: "confirmation" },
    weight: 10,
    halfLifeMs: 10 * MIN,
    group: "ambient",
    origin: "device",
    availableAt: "live",
    absentReason: null,
  },
  screen_off_motion: {
    // Common false negative: a driver using a phone mount for navigation
    // has the screen ON for the whole drive.
    kind: "screen_off_motion",
    tier: { ios: "confirmation", android: "confirmation" },
    weight: 10,
    halfLifeMs: 5 * MIN,
    group: "ambient",
    origin: "device",
    availableAt: "live",
    absentReason: null,
  },

  // ── Server-derived signals ──────────────────────────────────────────
  road_snapped: {
    // Same physical fact as sustained speed, so it shares the group and
    // is discounted rather than summed.
    kind: "road_snapped",
    tier: { ios: "confirmation", android: "confirmation" },
    weight: 25,
    halfLifeMs: 60 * MIN,
    group: "vehicle_motion",
    origin: "derived",
    availableAt: "retrospective",
    absentReason: null,
  },
  walking_track: {
    // The off-axis walk-away test already built and field-corrected in
    // drive-end.ts. The strongest counter-evidence we have.
    kind: "walking_track",
    tier: { ios: "confirmation", android: "confirmation" },
    weight: -40,
    halfLifeMs: 60 * MIN,
    group: "counter",
    origin: "derived",
    availableAt: "retrospective",
    absentReason: null,
  },
  low_displacement: {
    kind: "low_displacement",
    tier: { ios: "confirmation", android: "confirmation" },
    weight: -30,
    halfLifeMs: 60 * MIN,
    group: "counter",
    origin: "derived",
    availableAt: "retrospective",
    absentReason: null,
  },
  confined_to_parking_polygon: {
    kind: "confined_to_parking_polygon",
    tier: { ios: "confirmation", android: "confirmation" },
    weight: -25,
    halfLifeMs: 60 * MIN,
    group: "counter",
    origin: "derived",
    availableAt: "retrospective",
    absentReason: null,
  },
};

const KINDS = Object.keys(SIGNAL_REGISTRY) as SignalKind[];

export function isSignalKind(value: unknown): value is SignalKind {
  return typeof value === "string" && value in SIGNAL_REGISTRY;
}

export function signalDefinition(kind: SignalKind): SignalDefinition {
  return SIGNAL_REGISTRY[kind];
}

/** The tier of a kind on a platform, or null if that platform cannot
 *  produce it at all. Web produces none of these. */
export function signalTier(
  kind: SignalKind,
  platform: SignalPlatform,
): SignalTier | null {
  if (platform === "web") return null;
  return SIGNAL_REGISTRY[kind].tier[platform];
}

export function isWakeSource(
  kind: SignalKind,
  platform: SignalPlatform,
): boolean {
  return signalTier(kind, platform) === "wake";
}

/** Derived from the registry, never hand-maintained: a signal cannot
 *  acquire wake powers by being added to a second list. */
export function wakeSourcesFor(
  platform: Exclude<SignalPlatform, "web">,
): SignalKind[] {
  return KINDS.filter((k) => SIGNAL_REGISTRY[k].tier[platform] === "wake");
}

function asPlatform(value: unknown): SignalPlatform | null {
  return value === "ios" || value === "android" || value === "web"
    ? value
    : null;
}

function asFiniteMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Small tolerance for device/server clock skew before a timestamp is
 *  treated as poisoned. */
const CLOCK_SKEW_TOLERANCE_MS = 2 * MIN;

/**
 * Parse an untrusted wire payload into typed observations.
 *
 * Never throws, never silently drops: anything not accepted lands in
 * `rejected` with a reason, so a producer emitting nonsense shows up on
 * the health page instead of looking like a quiet device.
 */
export function parseSignalReport(input: unknown, nowMs: number): SignalReport {
  const out: SignalReport = { observations: [], availability: {}, rejected: [] };
  if (!input || typeof input !== "object") return out;
  const body = input as Record<string, unknown>;

  const rawAvailability = body.availability;
  if (rawAvailability && typeof rawAvailability === "object") {
    for (const [key, value] of Object.entries(
      rawAvailability as Record<string, unknown>,
    )) {
      if (!isSignalKind(key)) continue;
      out.availability[key] = AVAILABILITY_VALUES.includes(
        value as SignalAvailability,
      )
        ? (value as SignalAvailability)
        : "unknown";
    }
  }

  const raw = body.observations;
  if (!Array.isArray(raw)) return out;

  const capped = raw.slice(0, MAX_OBSERVATIONS_PER_REPORT);
  for (const entry of capped) {
    if (!entry || typeof entry !== "object") {
      out.rejected.push({ kind: null, reason: "malformed" });
      continue;
    }
    const o = entry as Record<string, unknown>;
    const kindRaw = o.kind;
    if (!isSignalKind(kindRaw)) {
      out.rejected.push({
        kind: typeof kindRaw === "string" ? kindRaw : null,
        reason: "unknown_kind",
      });
      continue;
    }
    const kind: SignalKind = kindRaw;
    const def = SIGNAL_REGISTRY[kind];

    if (def.origin === "derived") {
      out.rejected.push({ kind, reason: "not_device_reportable" });
      continue;
    }

    const platform = asPlatform(o.platform);
    if (!platform || signalTier(kind, platform) === null) {
      out.rejected.push({ kind, reason: "unsupported_on_platform" });
      continue;
    }

    const startedAtMs = asFiniteMs(o.startedAtMs);
    const lastSeenAtMs = asFiniteMs(o.lastSeenAtMs) ?? startedAtMs;
    const endedAtMs = o.endedAtMs == null ? null : asFiniteMs(o.endedAtMs);
    if (startedAtMs === null || lastSeenAtMs === null) {
      out.rejected.push({ kind, reason: "malformed" });
      continue;
    }
    const latest = Math.max(startedAtMs, lastSeenAtMs, endedAtMs ?? -Infinity);
    if (latest > nowMs + CLOCK_SKEW_TOLERANCE_MS) {
      out.rejected.push({ kind, reason: "future_timestamp" });
      continue;
    }
    if (
      lastSeenAtMs < startedAtMs ||
      (endedAtMs !== null && endedAtMs < startedAtMs)
    ) {
      out.rejected.push({ kind, reason: "malformed" });
      continue;
    }

    const rawStrength = asFiniteMs(o.strength);
    const observation: SignalObservation = {
      kind,
      platform,
      startedAtMs,
      lastSeenAtMs,
      endedAtMs,
      detail: typeof o.detail === "string" ? o.detail.slice(0, 200) : null,
    };
    if (rawStrength !== null) {
      observation.strength = Math.min(1, Math.max(0, rawStrength));
    }
    out.observations.push(observation);
  }

  if (raw.length > MAX_OBSERVATIONS_PER_REPORT) {
    out.rejected.push({ kind: null, reason: "too_many_observations" });
  }
  return out;
}
