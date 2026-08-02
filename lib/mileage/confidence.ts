/**
 * The multi-signal confidence engine.
 *
 * Pure: no platform imports, no Capacitor, no Supabase, no React, no
 * clock reads. Every instant is an argument. That is what makes the
 * scoring testable without a device, which matters because the failure
 * mode this project keeps hitting is code that reports healthy while
 * doing nothing, and a device is exactly where that hides.
 *
 * Three ideas do the work.
 *
 * 1. WEIGHTED EVIDENCE, NOT A COUNT. Signals differ enormously in
 *    reliability. A flat count of three lets "charging, screen off, and
 *    the Wi-Fi dropped" outvote sustained motorway speed. Each signal
 *    carries a weight on a 0-100 scale (see `SIGNAL_REGISTRY`).
 *
 * 2. CORRELATION GROUPS. The design doc says weights are "additive" and
 *    also says the signals are not independent. Both cannot hold.
 *    Sustained speed and a road-snapped track are one fact observed
 *    twice; adding 50 and 25 claims 75 points of independent evidence
 *    for a single observation. Within a group the strongest contribution
 *    counts in full and the rest are discounted. Across groups, plain
 *    sum. This is what actually delivers "a decisive signal cannot be
 *    outvoted by weak ones", rather than just asserting it.
 *
 * 3. AGE, WITH A LEVEL/EDGE DISTINCTION. A Bluetooth connect from 40
 *    minutes ago is not the evidence a connect from 40 seconds ago is.
 *    But a link that is STILL UP is not old evidence at all, it is
 *    present tense. So evidence ages from `endedAtMs ?? lastSeenAtMs`,
 *    which gives edge signals decay from the event and level signals no
 *    decay while they hold, under one rule.
 *
 * ── WHAT THIS MODULE MAY NOT DO ─────────────────────────────────────
 *
 * It may not start a trip on a confirmation signal. `evaluateArm` will
 * not return "track" without a wake-tier observation for the platform,
 * no matter how high the score. See the header of `signals.ts`.
 *
 * It may not mark a drive low-confidence because it had nothing to read.
 * Absence of evidence is not evidence of absence: an app build older
 * than the signal producers reports nothing, and scoring that as zero
 * would zero out every deduction in the fleet. That case returns
 * `tier: "unevaluated"` and callers must leave existing behaviour alone.
 */

import {
  signalDefinition,
  signalTier,
  type CorrelationGroup,
  type SignalAvailability,
  type SignalKind,
  type SignalObservation,
  type SignalPlatform,
} from "./signals";
import {
  DRIVING_SPEED_MPS,
  haversineMeters,
  type GpsPoint,
} from "./segmentation";
import { WALK_SPEED_MAX_MPS, WALK_SPEED_MIN_MPS } from "./drive-end";

const MIN = 60_000;

/**
 * Escalate to full-fidelity capture at 35. Deliberately low: one strong
 * signal, or two medium ones, is enough.
 *
 * The asymmetry that justifies it: a missed trip start is unrecoverable
 * AND invisible (the user cannot tell it happened), while a false start
 * is fully recoverable at finalize, when we hold the whole track. So we
 * start eagerly and prune in retrospect. See `scoreDrive` for the half
 * of that bargain that protects the user's trust.
 */
export const START_THRESHOLD = 35;

/** At or above this a drive is recorded as an ordinary, confirmed trip. */
export const HIGH_CONFIDENCE = 70;

/**
 * A candidate may be pruned only at or below this AND only with actual
 * counter-evidence. A quiet score means we learned nothing; deleting a
 * drive for that would be exactly the invisible data loss this whole
 * pipeline exists to stop.
 */
export const DISCARD_SCORE = 0;

/** How long a wake keeps us armed before standing down. Short, because
 *  the cost of arming is battery and standing down is cheap. */
export const ARM_WINDOW_MS = 3 * MIN;

/** Weight retained by the second and subsequent signals in one
 *  correlation group. */
export const CORRELATED_DISCOUNT = 0.5;

/** Evidence is worthless past this many half-lives (weight < 6.25%).
 *  The hard floor stops a long tail of stale signals accumulating. */
export const DECAY_HORIZON_HALF_LIVES = 4;

export type ConfidencePhase = "live" | "retrospective";

export type ConfidenceTier =
  /** >= HIGH_CONFIDENCE. Recorded as an ordinary trip. */
  | "high"
  /** >= START_THRESHOLD. Recorded, but never as established fact. */
  | "needs_review"
  /** Evaluated and came up short. Recorded, flagged, never auto-deducted. */
  | "insufficient"
  /** Nothing was readable. Callers must not change existing behaviour. */
  | "unevaluated";

export type SignalContribution = {
  kind: SignalKind;
  group: CorrelationGroup;
  baseWeight: number;
  strength: number;
  ageMs: number;
  /** 0 to 1. */
  decay: number;
  /** baseWeight * strength * decay, before the correlation discount. */
  effective: number;
};

export type UnavailableSignal = {
  kind: SignalKind;
  availability: SignalAvailability;
};

export type DriveConfidence = {
  score: number;
  tier: ConfidenceTier;
  /** False when nothing was readable. Guard every consequence on this. */
  evaluated: boolean;
  /**
   * True when a native producer actually contributed or reported.
   *
   * Derived track evidence alone is not the multi-signal apparatus, it
   * is what we already had. It may RAISE confidence and it may prune a
   * walk, but it must never demote a drive: doing that before any
   * producer ships would turn the whole fleet amber and zero its
   * deductions while adding no information whatsoever.
   */
  deviceEvidence: boolean;
  /** True only with positive counter-evidence. Never on a quiet score. */
  discard: boolean;
  contributions: SignalContribution[];
  /** Plain-language sentences for the review card. */
  reasons: string[];
  /** Every signal that could not be read, and why. Recorded so a denied
   *  permission is visible instead of looking like a quiet device. */
  unavailable: UnavailableSignal[];
};

function decayFactor(ageMs: number, halfLifeMs: number): number {
  if (ageMs <= 0) return 1;
  if (ageMs >= halfLifeMs * DECAY_HORIZON_HALF_LIVES) return 0;
  return Math.pow(0.5, ageMs / halfLifeMs);
}

/** Guard float noise from Math.pow without pretending to more precision
 *  than a 0-100 evidence scale carries. */
function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * `availableAt` says when a signal can be ACQUIRED, not when a recorded
 * observation may be used. A car link observed live is perfectly good
 * evidence at finalize; only the reverse is a lie, because a
 * retrospective-only signal cannot be read in the moment.
 */
function usableInPhase(kind: SignalKind, phase: ConfidencePhase): boolean {
  if (phase !== "live") return true;
  return signalDefinition(kind).availableAt !== "retrospective";
}

function contributionFor(
  o: SignalObservation,
  referenceMs: number,
): SignalContribution {
  const def = signalDefinition(o.kind);
  // Level signals still asserted age from the last confirmation; edge
  // signals set lastSeenAtMs === startedAtMs and age from the event.
  const ageMs = Math.max(0, referenceMs - (o.endedAtMs ?? o.lastSeenAtMs));
  const decay = decayFactor(ageMs, def.halfLifeMs);
  const strength =
    typeof o.strength === "number"
      ? Math.min(1, Math.max(0, o.strength))
      : 1;
  return {
    kind: o.kind,
    group: def.group,
    baseWeight: def.weight,
    strength,
    ageMs,
    decay: round(decay),
    effective: round(def.weight * strength * decay),
  };
}

/**
 * Combine contributions with the correlation discount. The largest
 * contribution by magnitude in each group counts in full; the rest are
 * discounted. Groups sum plainly. `none` is ungrouped bookkeeping and
 * always sums plainly, which is safe because everything in it is
 * weightless.
 */
function combine(contributions: readonly SignalContribution[]): number {
  const byGroup = new Map<CorrelationGroup, number[]>();
  for (const c of contributions) {
    if (c.group === "none") continue;
    const list = byGroup.get(c.group);
    if (list) list.push(c.effective);
    else byGroup.set(c.group, [c.effective]);
  }
  let total = 0;
  for (const values of byGroup.values()) {
    values.sort((a, b) => Math.abs(b) - Math.abs(a));
    total += values[0];
    for (let i = 1; i < values.length; i++) {
      total += values[i] * CORRELATED_DISCOUNT;
    }
  }
  return round(total);
}

/** Signals whose absence is worth explaining to the user, in the order
 *  the explanation reads best. */
const EXPLAINED_ABSENCES: readonly SignalKind[] = [
  "sustained_vehicle_speed",
  "car_bluetooth_connected",
  "car_audio_route",
  "geofence_exit",
];

function absenceReasons(
  present: ReadonlySet<SignalKind>,
  availability: Partial<Record<SignalKind, SignalAvailability>>,
  platform: SignalPlatform | null,
): string[] {
  const out: string[] = [];
  for (const kind of EXPLAINED_ABSENCES) {
    if (present.has(kind)) continue;
    const reason = signalDefinition(kind).absentReason;
    if (!reason) continue;
    // Never blame a signal the device could not have read. Telling an
    // iPhone user "no car connection detected" about an API iOS does not
    // have is noise dressed as diagnosis.
    if (platform && signalTier(kind, platform) === null) continue;
    const verdict = availability[kind];
    if (verdict === "unsupported" || verdict === "policy_blocked") continue;
    if (!out.includes(reason)) out.push(reason);
  }
  return out;
}

export type ScoreDriveInput = {
  observations: readonly SignalObservation[];
  availability: Partial<Record<SignalKind, SignalAvailability>>;
  /** Instant the score is anchored to. Finalize passes the trip start. */
  referenceMs: number;
  phase: ConfidencePhase;
  /** Used only to avoid explaining the absence of a signal the platform
   *  cannot produce. Inferred from the observations when omitted. */
  platform?: SignalPlatform;
};

export function scoreDrive(input: ScoreDriveInput): DriveConfidence {
  const { observations, availability, referenceMs, phase } = input;
  // Server-derived observations carry platform "web", which produces no
  // device signals at all. Inferring from one would silence every
  // absence reason, so only a real device platform counts.
  const platform =
    input.platform ??
    observations.find((o) => o.platform !== "web")?.platform ??
    null;

  const unavailable: UnavailableSignal[] = [];
  let anyAvailable = false;
  for (const [kind, verdict] of Object.entries(availability) as [
    SignalKind,
    SignalAvailability,
  ][]) {
    if (verdict === "available") anyAvailable = true;
    else unavailable.push({ kind, availability: verdict });
  }

  const usable = observations.filter((o) => usableInPhase(o.kind, phase));
  const contributions = usable.map((o) => contributionFor(o, referenceMs));

  // Absence of evidence is not evidence of absence. If nothing was
  // readable at all, say so and let the caller keep its existing
  // behaviour rather than inventing a low score.
  const evaluated = observations.length > 0 || anyAvailable;
  // Provenance, not the kind's declared origin: sustained speed is a
  // kind a producer CAN emit, but the copy `deriveTrackSignals` computes
  // server-side carries platform "web" and source "derived", and it must
  // not be mistaken for a producer having reported.
  const deviceEvidence =
    anyAvailable ||
    unavailable.length > 0 ||
    observations.some(
      (o) =>
        o.platform !== "web" &&
        o.source !== "derived" &&
        signalDefinition(o.kind).origin === "device",
    );
  if (!evaluated) {
    return {
      score: 0,
      tier: "unevaluated",
      evaluated: false,
      deviceEvidence,
      discard: false,
      contributions: [],
      reasons: [],
      unavailable,
    };
  }

  const score = combine(contributions);
  const present = new Set(contributions.map((c) => c.kind));
  const hasCounterEvidence = contributions.some(
    (c) => c.baseWeight < 0 && c.effective < 0,
  );

  const tier: ConfidenceTier =
    score >= HIGH_CONFIDENCE
      ? "high"
      : score >= START_THRESHOLD
        ? "needs_review"
        : "insufficient";

  return {
    score,
    tier,
    evaluated: true,
    deviceEvidence,
    discard: score <= DISCARD_SCORE && hasCounterEvidence,
    contributions,
    reasons:
      tier === "high"
        ? []
        : absenceReasons(present, availability, platform),
    unavailable,
  };
}

export type TripConfidenceDecision = {
  /** `needs_confirmation` to store on the trip row. */
  needsConfirmation: boolean;
  /** True when the candidate should not become a trip at all. */
  prune: boolean;
};

/**
 * The finalize-time half of the eager-start bargain.
 *
 * We start on weak evidence because a missed start is unrecoverable and
 * invisible while a false start is recoverable once the whole track is
 * in hand. The price of that is paid here, and it is paid in a specific
 * way: a low-confidence drive is UNCERTAIN FROM THE MOMENT IT APPEARS.
 * It is never shown as a confirmed trip and then retracted, because a
 * thing the user already accepted as fact vanishing is what actually
 * destroys trust. Showing an uncertain thing as uncertain does not.
 *
 * The mechanism is the `needs_confirmation` flag that already exists for
 * exactly this: it stores a zero deduction, keeps the drive out of every
 * tax total and out of the shared team view, and shows an amber
 * "confirm" card. There is no second concept here on purpose.
 *
 * Three refusals are encoded:
 *  - a human classification is never overridden and never deleted;
 *  - an unevaluated score changes nothing, because absence of evidence
 *    is not evidence of absence;
 *  - a drive is only pruned with positive counter-evidence.
 */
export function resolveTripConfidence(input: {
  confidence: DriveConfidence;
  /** What `autoClassify` already decided about the classification. */
  autoNeedsConfirmation: boolean;
  humanClassified: boolean;
}): TripConfidenceDecision {
  const { confidence, autoNeedsConfirmation, humanClassified } = input;

  if (humanClassified) {
    return { needsConfirmation: false, prune: false };
  }
  if (!confidence.evaluated) {
    return { needsConfirmation: autoNeedsConfirmation, prune: false };
  }
  if (confidence.discard) {
    return { needsConfirmation: true, prune: true };
  }
  // "Confident this was a drive" and "confident this was business" are
  // different claims. Neither clears the other.
  //
  // Demotion needs a producer to have actually reported. Track-derived
  // evidence can prune a walk (above) and can raise confidence, but it
  // must not push a drive into review on its own: that is the same
  // information we always had, and acting on it would zero the
  // deductions of every device whose signal producer has not shipped.
  const demote = confidence.deviceEvidence && confidence.tier !== "high";
  return {
    needsConfirmation: autoNeedsConfirmation || demote,
    prune: false,
  };
}

export type ArmAction = "track" | "hold" | "stand_down";

export type ArmRefusal = "no_wake_source" | "arm_window_expired";

export type ArmDecision = {
  action: ArmAction;
  score: number;
  tier: ConfidenceTier;
  /** Why we would not escalate. Recorded, never a bare "no". */
  refusal: ArmRefusal | null;
  reasons: string[];
};

export type EvaluateArmInput = {
  observations: readonly SignalObservation[];
  availability: Partial<Record<SignalKind, SignalAvailability>>;
  nowMs: number;
  /** When the wake that armed us fired. */
  armedAtMs: number;
  platform: SignalPlatform;
};

/**
 * The live escalate-or-stand-down decision.
 *
 * The structural guarantee lives here: no wake-tier observation for this
 * platform means no "track", whatever the score says. A confirmation
 * signal cannot start a process, so it must not be allowed to start a
 * trip either.
 */
export function evaluateArm(input: EvaluateArmInput): ArmDecision {
  const { observations, availability, nowMs, armedAtMs, platform } = input;

  const confidence = scoreDrive({
    observations,
    availability,
    referenceMs: nowMs,
    phase: "live",
    platform,
  });

  const hasWake = observations.some(
    (o) => o.platform === platform && signalTier(o.kind, platform) === "wake",
  );
  if (!hasWake) {
    return {
      action: "stand_down",
      score: confidence.score,
      tier: confidence.tier,
      refusal: "no_wake_source",
      reasons: confidence.reasons,
    };
  }

  if (confidence.score >= START_THRESHOLD) {
    return {
      action: "track",
      score: confidence.score,
      tier: confidence.tier,
      refusal: null,
      reasons: confidence.reasons,
    };
  }

  if (nowMs - armedAtMs <= ARM_WINDOW_MS) {
    return {
      action: "hold",
      score: confidence.score,
      tier: confidence.tier,
      refusal: null,
      reasons: confidence.reasons,
    };
  }

  // Past the window, but the car link is still up: the drive-through,
  // the fuel stop, the warm-up. You do not disconnect from your car to
  // buy petrol, so standing down here loses the drive about to resume.
  const vehiclePresent = observations.some(
    (o) =>
      signalDefinition(o.kind).group === "vehicle_presence" &&
      o.endedAtMs === null &&
      nowMs - o.lastSeenAtMs <= signalDefinition(o.kind).halfLifeMs,
  );
  if (vehiclePresent) {
    return {
      action: "hold",
      score: confidence.score,
      tier: confidence.tier,
      refusal: null,
      reasons: confidence.reasons,
    };
  }

  return {
    action: "stand_down",
    score: confidence.score,
    tier: confidence.tier,
    refusal: "arm_window_expired",
    reasons: confidence.reasons,
  };
}

// ── Server-derived evidence ───────────────────────────────────────────
//
// The engine must not be vacuous on the day it ships, before any native
// producer exists. Everything below is computed from the raw points we
// already store, needs no permission, and no device can forge it.

/** Sustained speed must hold this long before it is evidence at all. */
export const SUSTAINED_SPEED_MIN_MS = 60_000;
/** Sustained speed reaches full strength here. */
export const SUSTAINED_SPEED_FULL_MS = 5 * MIN;
/** Floor so a qualifying burst is never scored as nothing. */
export const SUSTAINED_SPEED_MIN_STRENGTH = 0.4;
/** Net displacement below this over a long window is counter-evidence. */
export const LOW_DISPLACEMENT_M = 300;
export const LOW_DISPLACEMENT_MIN_MS = 5 * MIN;
/** A walking verdict needs at least this many fixes to mean anything. */
export const WALK_MIN_FIXES = 6;

function derived(
  kind: SignalKind,
  points: readonly GpsPoint[],
  strength?: number,
): SignalObservation {
  const o: SignalObservation = {
    kind,
    platform: "web",
    startedAtMs: points[0].ts,
    lastSeenAtMs: points[points.length - 1].ts,
    endedAtMs: null,
    source: "derived",
    detail: null,
  };
  if (strength !== undefined) o.strength = strength;
  return o;
}

function speedAt(points: readonly GpsPoint[], i: number): number {
  const p = points[i];
  if (typeof p.speedMps === "number" && Number.isFinite(p.speedMps)) {
    return p.speedMps;
  }
  if (i === 0) return 0;
  const prev = points[i - 1];
  const dtS = (p.ts - prev.ts) / 1000;
  if (dtS <= 0) return 0;
  return haversineMeters(prev, p) / dtS;
}

/**
 * Evidence read off the track itself. Returns observations in the same
 * shape a native producer emits, so the scorer has one input type and
 * one decay rule regardless of where evidence came from.
 *
 * These are `derived` kinds in the registry, which the wire parser
 * refuses: a device that could post "this was a walk" could suppress its
 * owner's drives.
 */
export function deriveTrackSignals(
  points: readonly GpsPoint[],
): SignalObservation[] {
  if (points.length < 2) return [];
  const out: SignalObservation[] = [];

  // Longest unbroken run at driving speed.
  let bestRunMs = 0;
  let runStartTs: number | null = null;
  for (let i = 0; i < points.length; i++) {
    if (speedAt(points, i) >= DRIVING_SPEED_MPS) {
      if (runStartTs === null) runStartTs = points[i].ts;
      bestRunMs = Math.max(bestRunMs, points[i].ts - runStartTs);
    } else {
      runStartTs = null;
    }
  }

  if (bestRunMs >= SUSTAINED_SPEED_MIN_MS) {
    const span = SUSTAINED_SPEED_FULL_MS - SUSTAINED_SPEED_MIN_MS;
    const ramp = (bestRunMs - SUSTAINED_SPEED_MIN_MS) / span;
    const strength = Math.min(
      1,
      SUSTAINED_SPEED_MIN_STRENGTH +
        ramp * (1 - SUSTAINED_SPEED_MIN_STRENGTH),
    );
    out.push(
      derived("sustained_vehicle_speed", points, round(Math.max(
        SUSTAINED_SPEED_MIN_STRENGTH,
        strength,
      ))),
    );
  }

  const durationMs = points[points.length - 1].ts - points[0].ts;
  const netM = haversineMeters(points[0], points[points.length - 1]);

  // A loop drive returns to where it started, so net displacement alone
  // would condemn every round trip. Only call it low displacement when
  // the track never reached driving speed either.
  if (
    bestRunMs < SUSTAINED_SPEED_MIN_MS &&
    durationMs >= LOW_DISPLACEMENT_MIN_MS &&
    netM < LOW_DISPLACEMENT_M
  ) {
    out.push(derived("low_displacement", points));
  }

  if (bestRunMs < SUSTAINED_SPEED_MIN_MS && points.length >= WALK_MIN_FIXES) {
    let walking = 0;
    let moving = 0;
    for (let i = 1; i < points.length; i++) {
      const v = speedAt(points, i);
      if (v < WALK_SPEED_MIN_MPS) continue;
      moving++;
      if (v <= WALK_SPEED_MAX_MPS) walking++;
    }
    if (moving >= WALK_MIN_FIXES - 1 && walking / moving >= 0.8) {
      out.push(derived("walking_track", points));
    }
  }

  return out;
}
