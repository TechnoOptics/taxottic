/**
 * Adapter from the native producers' event stream to the scoring
 * engine's interval model.
 *
 * Pure. The native sides emit INSTANTS ("route changed at T", "we looked
 * at T and saw a car"); the scorer reasons about INTERVALS, because a
 * connection that is still up is present-tense evidence and must not
 * age, while a connection that dropped ten minutes ago must. Folding one
 * into the other is this file's whole job.
 *
 * ── CONTRACT ────────────────────────────────────────────────────────
 *
 * `NativeVehicleSignalEvent` mirrors `VehicleSignalEvent` in
 * `lib/mileage/device-status.ts`, which the iOS producer emits. It is
 * restated structurally rather than imported because `device-status.ts`
 * pulls in Capacitor, and this module must stay free of platform
 * imports so it runs in the finalize path server-side. If the two ever
 * drift, this is the file that breaks, and the tests here are what say
 * so.
 *
 * ── THREE RULES FROM THE PRODUCERS ──────────────────────────────────
 *
 * 1. `source` is not collapsible. A `poll` that finds the phone
 *    connected to car audio establishes a LEVEL, not a transition. We
 *    cannot tell a car that just started from one parked with the
 *    accessories on all evening, so a connection only ever seen by a
 *    poll is discounted (`POLL_ONLY_STRENGTH`) and cannot clear the
 *    trip-start bar unaided.
 *
 * 2. Motion history proves a drive happened, never where it went. There
 *    is no location in that data. `captureAudit` events therefore become
 *    GAPS, never observations: they surface a detected failure and can
 *    never contribute a deductible mile.
 *
 * 3. `stationary` and `automotive` are non-exclusive in CoreMotion.
 *    Stopped at a light reads as both. A stationary reading is never
 *    counter-evidence and never closes an automotive interval, because
 *    treating it as either would chop every drive at every junction.
 */

import {
  signalTier,
  type SignalKind,
  type SignalObservation,
  type SignalObservationSource,
  type SignalPlatform,
  type SignalRejection,
} from "./signals";

export type NativeVehicleSignalKind =
  | "carAudioRoute"
  | "motionActivity"
  | "motionHistory"
  | "captureAudit";

export type NativeVehicleSignalSource =
  | "event"
  | "poll"
  | "live"
  | "history"
  | "audit";

export type NativeVehicleSignalEvent = {
  kind: NativeVehicleSignalKind;
  /** Kind-specific vocabulary: "connected", "automotive", "drivingMissed". */
  state: string;
  /** Wall-clock epoch ms. Lines up with captured GPS points. */
  tsMs: number;
  /** Ms since boot. Comparable only within one `bootMs` epoch. */
  monotonicMs: number;
  /** Wall-clock instant of the boot that `monotonicMs` counts from. */
  bootMs: number;
  source: NativeVehicleSignalSource;
  /** 0 to 1 where the API supplies one; null where it does not. */
  confidence: number | null;
  detail?: Record<string, unknown>;
};

/** A stretch of time the OS says we were driving and we captured
 *  nothing. Duration only: there is no location in motion history, so a
 *  gap is reported and never filled. */
export type CaptureGap = {
  fromMs: number;
  toMs: number;
  gapMs: number;
  /** Automotive time the OS recorded inside the gap. */
  automotiveMs: number;
};

export type FoldedSignals = {
  observations: SignalObservation[];
  gaps: CaptureGap[];
  rejected: SignalRejection[];
  /** Events whose wall clock disagreed with the monotonic clock and were
   *  rewritten. Counted so a device with a moving clock is visible. */
  clockCorrections: number;
};

/**
 * Weight retained by a car connection that no transition event ever
 * opened. 45 * 0.7 = 31.5, deliberately under `START_THRESHOLD` (35):
 * a poll-only connection must be corroborated before it starts a trip.
 */
export const POLL_ONLY_STRENGTH = 0.7;

/** Wall clock may disagree with the monotonic clock by this much before
 *  we conclude the clock moved. */
export const CLOCK_DRIFT_TOLERANCE_MS = 60_000;

/** Same skew allowance the wire parser uses. */
const FUTURE_TOLERANCE_MS = 2 * 60_000;

type Mapped = {
  kind: SignalKind;
  /** Whether this event asserts the signal (vs releases it). */
  asserted: boolean;
};

/**
 * (native kind, state) to a scoring kind. Anything not listed is either
 * unknown (recorded as a rejection) or deliberately inert: a
 * `stationary` motion reading maps to nothing at all, per rule 3.
 */
function mapKind(e: NativeVehicleSignalEvent): Mapped | null | "unknown" {
  switch (e.kind) {
    case "carAudioRoute":
      if (e.state === "connected") {
        return { kind: "car_audio_route", asserted: true };
      }
      if (e.state === "disconnected") {
        return { kind: "car_audio_route", asserted: false };
      }
      return null;
    case "motionActivity":
      if (e.state === "automotive") {
        return { kind: "motion_activity_automotive", asserted: true };
      }
      // stationary, walking, cycling and unknown all map to nothing.
      // Notably stationary: it co-occurs with automotive at every red
      // light and is never evidence against a drive.
      return null;
    case "motionHistory":
      if (e.state === "automotive") {
        return { kind: "motion_history_automotive", asserted: true };
      }
      return null;
    case "captureAudit":
      return null;
    default:
      return "unknown";
  }
}

function numberAt(
  detail: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const v = detail?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Correct an event's wall clock from its monotonic clock.
 *
 * Only meaningful within the boot epoch the drain reported: events from
 * an earlier boot have a different monotonic origin and are left alone.
 */
function correctedTs(
  wallMs: number,
  monotonicMs: number,
  eventBootMs: number,
  drainBootMs: number,
): { tsMs: number; corrected: boolean } {
  // Equal boot epoch means the two monotonic clocks are comparable.
  // Different means a reboot happened and only the wall clock is usable;
  // differencing across it would fabricate hours of age. Both producers
  // send the same three fields for exactly this reason (iOS tsMs /
  // monotonicMs / bootMs, Android atMs / elapsedRealtimeMs / bootAtMs).
  if (eventBootMs !== drainBootMs) return { tsMs: wallMs, corrected: false };
  const expected = eventBootMs + monotonicMs;
  if (Math.abs(expected - wallMs) <= CLOCK_DRIFT_TOLERANCE_MS) {
    return { tsMs: wallMs, corrected: false };
  }
  return { tsMs: expected, corrected: true };
}

type OpenInterval = {
  kind: SignalKind;
  startedAtMs: number;
  lastSeenAtMs: number;
  endedAtMs: number | null;
  source: SignalObservationSource;
  /** True when a real transition event opened this interval. */
  transitionSeen: boolean;
  /** Strongest confidence the producer reported for this interval. */
  confidence: number | null;
};

export type FoldOptions = {
  platform: SignalPlatform;
  nowMs: number;
  /** Boot epoch the drain reported, for clock correction. */
  bootMs: number;
};

export function foldVehicleSignalEvents(
  events: readonly NativeVehicleSignalEvent[],
  opts: FoldOptions,
): FoldedSignals {
  const out: FoldedSignals = {
    observations: [],
    gaps: [],
    rejected: [],
    clockCorrections: 0,
  };

  const prepared: {
    e: NativeVehicleSignalEvent;
    tsMs: number;
    mapped: Mapped | null;
  }[] = [];
  for (const e of events) {
    if (!e || typeof e !== "object") {
      out.rejected.push({ kind: null, reason: "malformed" });
      continue;
    }
    const mapped = mapKind(e);
    if (mapped === "unknown") {
      out.rejected.push({ kind: null, reason: "unknown_kind" });
      continue;
    }
    const { tsMs, corrected } = correctedTs(
      e.tsMs,
      e.monotonicMs,
      e.bootMs,
      opts.bootMs,
    );
    if (corrected) out.clockCorrections++;
    if (tsMs > opts.nowMs + FUTURE_TOLERANCE_MS) {
      out.rejected.push({ kind: mapped?.kind ?? null, reason: "future_timestamp" });
      continue;
    }
    prepared.push({ e, tsMs, mapped });
  }
  prepared.sort((a, b) => a.tsMs - b.tsMs);

  const open = new Map<SignalKind, OpenInterval>();
  const closed: OpenInterval[] = [];

  for (const { e, tsMs, mapped } of prepared) {
    if (e.kind === "captureAudit") {
      // Rule 2: a gap is a reported failure, never a drive. "unknown"
      // means the device was off, so nothing was missed.
      if (e.state !== "drivingMissed") continue;
      const automotiveMs = numberAt(e.detail, "automotiveMs") ?? 0;
      if (automotiveMs <= 0) continue;
      const toMs = numberAt(e.detail, "toTsMs") ?? tsMs;
      const gapMs = numberAt(e.detail, "gapMs") ?? 0;
      out.gaps.push({
        fromMs: numberAt(e.detail, "fromTsMs") ?? toMs - gapMs,
        toMs,
        gapMs,
        automotiveMs,
      });
      continue;
    }

    if (!mapped) continue;

    if (signalTier(mapped.kind, opts.platform) === null) {
      out.rejected.push({
        kind: mapped.kind,
        reason: "unsupported_on_platform",
      });
      continue;
    }

    const current = open.get(mapped.kind);

    if (!mapped.asserted) {
      if (current) {
        current.endedAtMs = tsMs;
        closed.push(current);
        open.delete(mapped.kind);
      }
      continue;
    }

    if (current) {
      // Rule 1: a poll extends the level it found. It does not reopen
      // the interval, and it does not overwrite a known transition.
      current.lastSeenAtMs = tsMs;
      if (e.source === "event") current.transitionSeen = true;
      if (typeof e.confidence === "number") {
        current.confidence = Math.max(current.confidence ?? 0, e.confidence);
      }
      continue;
    }

    open.set(mapped.kind, {
      kind: mapped.kind,
      startedAtMs: tsMs,
      lastSeenAtMs: tsMs,
      endedAtMs: null,
      source: e.source,
      transitionSeen: e.source === "event",
      confidence: e.confidence,
    });
  }

  out.observations = intervalsToObservations(
    [...closed, ...open.values()],
    opts.platform,
  );
  return out;
}

/**
 * One interval-to-observation step for both platforms.
 *
 * This is the "one internal shape" boundary: iOS speaks
 * kind/state/tsMs/source/confidence, Android speaks
 * kind/state/atMs/vehicleClass/wakeOutcome, and neither dialect reaches
 * the scorer. Adapting here rather than teaching the scorer two
 * vocabularies is what keeps the weighting honest across platforms.
 */
function intervalsToObservations(
  intervals: readonly OpenInterval[],
  platform: SignalPlatform,
): SignalObservation[] {
  const out = intervals.map((interval) => {
    const o: SignalObservation = {
      kind: interval.kind,
      platform,
      startedAtMs: interval.startedAtMs,
      lastSeenAtMs: interval.lastSeenAtMs,
      endedAtMs: interval.endedAtMs,
      source: interval.source,
      detail: null,
    };
    // A producer-supplied confidence is graded evidence. A connection
    // never confirmed by a transition is discounted instead.
    if (interval.confidence !== null) {
      o.strength = interval.confidence;
    } else if (!interval.transitionSeen) {
      o.strength = POLL_ONLY_STRENGTH;
    }
    return o;
  });
  out.sort((a, b) => a.startedAtMs - b.startedAtMs);
  return out;
}

/* ------------------------------------------------------------------ *
 * Android
 *
 * A JSONL ring in app storage, read with `readCarSignals()` and cleared
 * with `consumeCarSignals(n)`. Same read-then-acknowledge discipline as
 * iOS. Mirrors `lib/mileage/car-signals.ts`; restated structurally for
 * the same reason as the iOS shape above.
 * ------------------------------------------------------------------ */

/** Not a boolean. `blocked_no_background_permission` in particular means
 *  a drive WAS detected and still lost, which is the most actionable
 *  state in the whole system. */
export type AndroidWakeOutcome =
  | "started"
  | "already_running"
  | "blocked_no_background_permission"
  | "blocked_service_start_denied"
  | "not_a_wake_source"
  | "not_vehicle_class";

export type AndroidCarSignalEvent = {
  v?: number;
  seq?: number;
  kind: "bluetooth" | "projection" | "power";
  state: "connected" | "disconnected";
  /** Wall clock. Can jump; never difference it directly. */
  atMs: number;
  /** Monotonic, includes deep sleep. Comparable only within one boot. */
  elapsedRealtimeMs: number;
  bootAtMs: number;
  deviceId?: string;
  deviceName?: string;
  deviceMajorClass?: string;
  deviceClass?: string;
  deviceMajorClassRaw?: number;
  deviceClassRaw?: number;
  /** True ONLY for car_audio and handsfree. The gate that matters:
   *  headphones and speakers reach the log with this false. */
  vehicleClass?: boolean;
  plugged?: boolean;
  projectionType?: string;
  wakeAttempted?: boolean;
  wakeOutcome?: AndroidWakeOutcome;
  wakeDetail?: string;
};

export type FoldedCarSignals = FoldedSignals & {
  /** Every wake outcome seen, for the degraded ladder. */
  wakeOutcomes: AndroidWakeOutcome[];
  /** Bluetooth connects filtered out for not being a vehicle device.
   *  Counted, not rejected: earbuds connecting is normal, not an error,
   *  but the number is worth being able to see. */
  nonVehicleFiltered: number;
};

function mapAndroidKind(e: AndroidCarSignalEvent): SignalKind | null {
  switch (e.kind) {
    case "bluetooth":
      return "car_bluetooth_connected";
    case "projection":
      return "android_auto_connected";
    case "power":
      return "charging_connected";
    default:
      return null;
  }
}

export function foldCarSignalEvents(
  events: readonly AndroidCarSignalEvent[],
  opts: FoldOptions,
): FoldedCarSignals {
  const out: FoldedCarSignals = {
    observations: [],
    gaps: [],
    rejected: [],
    clockCorrections: 0,
    wakeOutcomes: [],
    nonVehicleFiltered: 0,
  };

  const prepared: {
    kind: SignalKind;
    asserted: boolean;
    tsMs: number;
  }[] = [];

  for (const e of events) {
    if (!e || typeof e !== "object") {
      out.rejected.push({ kind: null, reason: "malformed" });
      continue;
    }
    if (e.wakeOutcome) out.wakeOutcomes.push(e.wakeOutcome);

    const kind = mapAndroidKind(e);
    if (!kind) {
      out.rejected.push({ kind: null, reason: "unknown_kind" });
      continue;
    }

    // The vehicle-class gate. It describes a BLUETOOTH device class, so
    // it applies to bluetooth events and to nothing else: a USB charger
    // has no device class and must not be suppressed by one.
    if (e.kind === "bluetooth" && e.vehicleClass !== true) {
      out.nonVehicleFiltered++;
      continue;
    }

    if (signalTier(kind, opts.platform) === null) {
      out.rejected.push({ kind, reason: "unsupported_on_platform" });
      continue;
    }

    const { tsMs, corrected } = correctedTs(
      e.atMs,
      e.elapsedRealtimeMs,
      e.bootAtMs,
      opts.bootMs,
    );
    if (corrected) out.clockCorrections++;
    if (tsMs > opts.nowMs + FUTURE_TOLERANCE_MS) {
      out.rejected.push({ kind, reason: "future_timestamp" });
      continue;
    }
    prepared.push({ kind, asserted: e.state === "connected", tsMs });
  }
  prepared.sort((a, b) => a.tsMs - b.tsMs);

  const open = new Map<SignalKind, OpenInterval>();
  const closed: OpenInterval[] = [];
  for (const entry of prepared) {
    const current = open.get(entry.kind);
    if (!entry.asserted) {
      if (current) {
        current.endedAtMs = entry.tsMs;
        closed.push(current);
        open.delete(entry.kind);
      }
      continue;
    }
    if (current) {
      current.lastSeenAtMs = entry.tsMs;
      continue;
    }
    open.set(entry.kind, {
      kind: entry.kind,
      startedAtMs: entry.tsMs,
      lastSeenAtMs: entry.tsMs,
      endedAtMs: null,
      // Android emits broadcast-driven transitions only; there is no
      // poll path, so every interval here is event-backed and none of
      // them takes the poll discount.
      source: "event",
      transitionSeen: true,
      confidence: null,
    });
  }

  out.observations = intervalsToObservations(
    [...closed, ...open.values()],
    opts.platform,
  );
  return out;
}
