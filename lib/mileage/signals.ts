/**
 * The vehicle-signal contract: what a signal is, which platform can
 * produce it, and whether the OS will start our process for it.
 *
 * Pure. No Capacitor, no Supabase, no React, so it runs unchanged in the
 * WebView, in a route handler and in a unit test.
 *
 * ── SCOPE ───────────────────────────────────────────────────────────
 *
 * This file carries ONLY what is needed to move signals from a native
 * producer to a stored, readable row. There is deliberately no weight,
 * no half-life, no correlation group and no scoring: zero car
 * connections have ever been recorded on either platform, and a fusion
 * model built on inputs that have never once fired would be tuned
 * against nothing. Wire the producers, watch what arrives, THEN weigh
 * it. Salvaged from the closed PR #496, which built the scorer first.
 *
 * ── THE DISTINCTION THIS FILE DOES KEEP ─────────────────────────────
 *
 * Signals split into two tiers and they are NOT interchangeable.
 *
 *   WAKE SOURCES are events the OS will actually start our process for.
 *   CONFIRMATION SIGNALS are evaluated once we are already awake. They
 *   can describe a drive. They cannot start one.
 *
 * A confirmation signal must never be load-bearing for starting a trip.
 * Car Bluetooth is the strongest evidence of a drive available to us and
 * on iOS it cannot wake us at all: classic A2DP/HFP car audio is
 * invisible to CoreBluetooth, and the restoration path would need a
 * `bluetooth-central` background mode we do not declare. On Android,
 * `ACTION_ACL_CONNECTED` does start a dead process, and each event
 * carries its own `wakeOutcome` so the claim keeps proving itself in the
 * field rather than resting on one device test.
 *
 * The registry is the only place tier is decided, so a signal cannot
 * quietly acquire wake powers by being added in two places.
 */

export type SignalPlatform = "ios" | "android" | "web";

export type SignalTier = "wake" | "confirmation";

export type SignalKind =
  | "car_bluetooth_connected"
  | "car_audio_route"
  | "android_auto_connected"
  | "charging_connected"
  | "motion_activity_automotive"
  | "motion_history_automotive";

/**
 * How the producer came to know. Load-bearing, and deliberately not
 * collapsed: `"event"` means a transition actually fired, `"poll"` means
 * we looked at that instant and found the signal true. A poll at 08:14
 * is NOT evidence that the car connected at 08:14, and letting a stale
 * connection read as a fresh one is exactly how a parked car becomes a
 * phantom trip.
 */
export type SignalObservationSource =
  | "event"
  | "poll"
  | "live"
  | "history"
  | "audit";

const SOURCE_VALUES: readonly SignalObservationSource[] = [
  "event",
  "poll",
  "live",
  "history",
  "audit",
];

/**
 * One observation of one signal.
 *
 * Deliberately an INTERVAL, not an instant. A car connection is a level,
 * not an edge: while it still holds it is present-tense evidence. An edge
 * signal sets `lastSeenAtMs === startedAtMs`.
 *
 * `lastSeenAtMs` is when the producer last CONFIRMED the signal held, not
 * when it uploaded.
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
   * Some signals are graded: CoreMotion reports low/medium/high, and a
   * connection no transition ever opened is discounted. Producers with
   * nothing to grade omit it.
   */
  strength?: number;
  source?: SignalObservationSource;
  detail: string | null;
};

export type SignalRejectionReason =
  | "unknown_kind"
  | "unsupported_on_platform"
  | "future_timestamp"
  | "malformed"
  | "too_many_observations";

export type SignalRejection = {
  kind: string | null;
  reason: SignalRejectionReason;
};

export type SignalReport = {
  observations: SignalObservation[];
  /** Every input we would not accept, with the reason. Persisted and
   *  shown, so a producer emitting garbage is visible rather than
   *  silently ignored. */
  rejected: SignalRejection[];
};

export type SignalDefinition = {
  kind: SignalKind;
  /** Tier per platform. `null` means the platform cannot produce it. */
  tier: { ios: SignalTier | null; android: SignalTier | null };
};

/** Hard cap on observations accepted from one payload. A native producer
 *  looping on a broadcast must not be able to fill the column. */
export const MAX_OBSERVATIONS_PER_REPORT = 64;

export const SIGNAL_REGISTRY: Readonly<Record<SignalKind, SignalDefinition>> = {
  car_bluetooth_connected: {
    // The only wake-capable entry here, and Android only. Proven on a
    // real handset: the manifest receiver starts a dead process, and the
    // outcome is reported per event as `wakeOutcome`. Must never be
    // generalised to iOS, where classic car audio is invisible to
    // CoreBluetooth.
    kind: "car_bluetooth_connected",
    tier: { ios: null, android: "wake" },
  },
  car_audio_route: {
    // The iOS counterpart: AVAudioSession.currentRoute naming a car port.
    // Readable while awake, and NOT a wake source (see file header).
    kind: "car_audio_route",
    tier: { ios: "confirmation", android: null },
  },
  android_auto_connected: {
    // Stronger than plain Bluetooth (you do not get a projection session
    // walking past a parked car), same physical fact.
    kind: "android_auto_connected",
    tier: { ios: null, android: "confirmation" },
  },
  charging_connected: {
    // A desk charger looks identical to a car charger. Weak by nature,
    // carried because the producer already emits it.
    kind: "charging_connected",
    tier: { ios: "confirmation", android: "confirmation" },
  },
  motion_activity_automotive: {
    // Apple's own classifier, live. Laggy, and it confuses bus and train.
    kind: "motion_activity_automotive",
    tier: { ios: "confirmation", android: null },
  },
  motion_history_automotive: {
    // CMMotionActivityManager's seven-day history. Cannot wake us and
    // cannot be queried usefully in the moment, but it is what makes an
    // iOS blackout visible after the fact. Contains NO location, so it
    // can establish that a drive happened and never where it went.
    kind: "motion_history_automotive",
    tier: { ios: "confirmation", android: null },
  },
};

export function isSignalKind(value: unknown): value is SignalKind {
  return typeof value === "string" && value in SIGNAL_REGISTRY;
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

function asPlatform(value: unknown): SignalPlatform | null {
  return value === "ios" || value === "android" || value === "web"
    ? value
    : null;
}

function asFinite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Small tolerance for device/server clock skew before a timestamp is
 *  treated as poisoned. */
const CLOCK_SKEW_TOLERANCE_MS = 2 * 60_000;

/**
 * Parse an untrusted wire payload into typed observations.
 *
 * Never throws, never silently drops: anything not accepted lands in
 * `rejected` with a reason, so a producer emitting nonsense shows up in
 * the heartbeat row instead of looking like a quiet device.
 */
export function parseSignalReport(input: unknown, nowMs: number): SignalReport {
  const out: SignalReport = { observations: [], rejected: [] };
  if (!input || typeof input !== "object") return out;
  const raw = (input as Record<string, unknown>).observations;
  if (!Array.isArray(raw)) return out;

  for (const entry of raw.slice(0, MAX_OBSERVATIONS_PER_REPORT)) {
    if (!entry || typeof entry !== "object") {
      out.rejected.push({ kind: null, reason: "malformed" });
      continue;
    }
    const o = entry as Record<string, unknown>;
    if (!isSignalKind(o.kind)) {
      out.rejected.push({
        kind: typeof o.kind === "string" ? o.kind : null,
        reason: "unknown_kind",
      });
      continue;
    }
    const kind: SignalKind = o.kind;

    const platform = asPlatform(o.platform);
    if (!platform || signalTier(kind, platform) === null) {
      out.rejected.push({ kind, reason: "unsupported_on_platform" });
      continue;
    }

    const startedAtMs = asFinite(o.startedAtMs);
    const lastSeenAtMs = asFinite(o.lastSeenAtMs) ?? startedAtMs;
    const endedAtMs = o.endedAtMs == null ? null : asFinite(o.endedAtMs);
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

    const observation: SignalObservation = {
      kind,
      platform,
      startedAtMs,
      lastSeenAtMs,
      endedAtMs,
      detail: typeof o.detail === "string" ? o.detail.slice(0, 200) : null,
    };
    const strength = asFinite(o.strength);
    if (strength !== null) {
      observation.strength = Math.min(1, Math.max(0, strength));
    }
    // Carried, not dropped. See the round-trip test: `source` is the
    // difference between "the car connected then" and "the car was
    // already connected when we happened to look".
    if (SOURCE_VALUES.includes(o.source as SignalObservationSource)) {
      observation.source = o.source as SignalObservationSource;
    }
    out.observations.push(observation);
  }

  if (raw.length > MAX_OBSERVATIONS_PER_REPORT) {
    out.rejected.push({ kind: null, reason: "too_many_observations" });
  }
  return out;
}
