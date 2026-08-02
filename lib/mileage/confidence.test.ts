import { describe, expect, it } from "vitest";
import {
  ARM_WINDOW_MS,
  DISCARD_SCORE,
  HIGH_CONFIDENCE,
  START_THRESHOLD,
  deriveTrackSignals,
  evaluateArm,
  resolveTripConfidence,
  scoreDrive,
} from "./confidence";
import type { SignalKind, SignalObservation } from "./signals";
import type { GpsPoint } from "./segmentation";

const NOW = 1_800_000_000_000;
const m = (n: number) => n * 60_000;
const s = (n: number) => n * 1_000;

function obs(
  kind: SignalKind,
  over: Partial<SignalObservation> = {},
): SignalObservation {
  const at = over.startedAtMs ?? NOW;
  return {
    kind,
    platform: "android",
    startedAtMs: at,
    lastSeenAtMs: at,
    endedAtMs: null,
    detail: null,
    ...over,
  };
}

describe("scoreDrive with no signals at all", () => {
  it("reports unevaluated rather than zero confidence when nothing was observed and nothing was available", () => {
    // The regression this guards: an app build older than the signal
    // producers reports nothing. Scoring that as 0 would mark every trip
    // in the fleet low-confidence and zero out every deduction.
    const r = scoreDrive({
      observations: [],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.tier).toBe("unevaluated");
    expect(r.score).toBe(0);
    expect(r.evaluated).toBe(false);
    expect(r.discard).toBe(false);
    expect(r.contributions).toEqual([]);
  });

  it("never prunes a trip it could not evaluate", () => {
    const r = scoreDrive({
      observations: [],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.discard).toBe(false);
  });

  it("becomes evaluated once a signal was available but observed absent", () => {
    // "Bluetooth was on and no car connected" is real evidence. It is not
    // the same as "we never looked".
    const r = scoreDrive({
      observations: [],
      availability: { car_bluetooth_connected: "available" },
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.evaluated).toBe(true);
    expect(r.tier).toBe("insufficient");
  });

  it("records every unavailable signal with its reason", () => {
    const r = scoreDrive({
      observations: [],
      availability: {
        car_bluetooth_connected: "permission_denied",
        motion_activity_automotive: "policy_blocked",
      },
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.unavailable).toEqual([
      { kind: "car_bluetooth_connected", availability: "permission_denied" },
      { kind: "motion_activity_automotive", availability: "policy_blocked" },
    ]);
    expect(r.evaluated).toBe(false);
  });
});

describe("scoreDrive weighting", () => {
  it("lets one decisive signal outrank three weak ones", () => {
    const decisive = scoreDrive({
      observations: [obs("car_bluetooth_connected")],
      availability: {},
      referenceMs: NOW,
      phase: "live",
    });
    const weak = scoreDrive({
      observations: [
        obs("charging_connected"),
        obs("screen_off_motion"),
        obs("significant_location_change"),
      ],
      availability: {},
      referenceMs: NOW,
      phase: "live",
    });
    expect(decisive.score).toBeGreaterThan(weak.score);
    expect(weak.score).toBeLessThan(START_THRESHOLD);
  });

  it("discounts a second signal from the same correlation group", () => {
    // Sustained speed and a road-snapped track are one physical fact seen
    // twice. Summing them at full weight double-counts the evidence.
    const both = scoreDrive({
      observations: [obs("sustained_vehicle_speed"), obs("road_snapped")],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    const speedOnly = scoreDrive({
      observations: [obs("sustained_vehicle_speed")],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    const naiveSum = 50 + 25;
    expect(both.score).toBeGreaterThan(speedOnly.score);
    expect(both.score).toBeLessThan(naiveSum);
    expect(both.score).toBe(50 + 25 * 0.5);
  });

  it("sums across correlation groups at full weight", () => {
    const r = scoreDrive({
      observations: [obs("geofence_exit"), obs("sustained_vehicle_speed")],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.score).toBe(80);
    expect(r.tier).toBe("high");
  });

  it("scales a graded signal by its reported strength", () => {
    const weak = scoreDrive({
      observations: [obs("sustained_vehicle_speed", { strength: 0.4 })],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(weak.score).toBe(20);
  });

  it("ignores a retrospective-only signal during a live decision", () => {
    // The seven-day motion history cannot be queried usefully in the
    // moment; letting it score a live arm would be a lie.
    const r = scoreDrive({
      observations: [obs("motion_history_automotive", { platform: "ios" })],
      availability: {},
      referenceMs: NOW,
      phase: "live",
    });
    expect(r.contributions).toEqual([]);
    expect(r.score).toBe(0);
  });

  it("counts the same retrospective signal when scoring a finished trip", () => {
    const r = scoreDrive({
      observations: [obs("motion_history_automotive", { platform: "ios" })],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.score).toBe(25);
  });
});

describe("scoreDrive decay", () => {
  it("does not age a signal that is still asserted", () => {
    // A car Bluetooth link that has not dropped is present-tense
    // evidence, not a memory of one.
    const r = scoreDrive({
      observations: [
        obs("car_bluetooth_connected", {
          startedAtMs: NOW - m(40),
          lastSeenAtMs: NOW,
          endedAtMs: null,
        }),
      ],
      availability: {},
      referenceMs: NOW,
      phase: "live",
    });
    expect(r.score).toBe(45);
  });

  it("halves a signal's weight after one half-life", () => {
    const r = scoreDrive({
      observations: [
        obs("car_bluetooth_connected", {
          startedAtMs: NOW - m(20),
          lastSeenAtMs: NOW - m(10),
          endedAtMs: NOW - m(10),
        }),
      ],
      availability: {},
      referenceMs: NOW,
      phase: "live",
    });
    expect(r.score).toBe(22.5);
    expect(r.contributions[0].decay).toBe(0.5);
  });

  it("drops a signal to zero past its horizon rather than trailing forever", () => {
    const r = scoreDrive({
      observations: [
        obs("car_bluetooth_connected", {
          startedAtMs: NOW - m(90),
          lastSeenAtMs: NOW - m(80),
          endedAtMs: NOW - m(80),
        }),
      ],
      availability: {},
      referenceMs: NOW,
      phase: "live",
    });
    expect(r.score).toBe(0);
    expect(r.contributions[0].effective).toBe(0);
  });

  it("does not age a signal observed after the reference instant", () => {
    const r = scoreDrive({
      observations: [
        obs("car_bluetooth_connected", {
          startedAtMs: NOW + m(5),
          lastSeenAtMs: NOW + m(9),
        }),
      ],
      availability: {},
      referenceMs: NOW,
      phase: "live",
    });
    expect(r.score).toBe(45);
  });
});

describe("scoreDrive counter-evidence", () => {
  it("subtracts a walking track from a geofence exit", () => {
    const r = scoreDrive({
      observations: [obs("geofence_exit"), obs("walking_track")],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.score).toBe(-10);
    expect(r.tier).toBe("insufficient");
  });

  it("marks a walk out of the driveway for discard", () => {
    const r = scoreDrive({
      observations: [
        obs("geofence_exit"),
        obs("walking_track"),
        obs("low_displacement"),
      ],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.score).toBeLessThanOrEqual(DISCARD_SCORE);
    expect(r.discard).toBe(true);
  });

  it("refuses to discard on a low score alone, with no counter-evidence", () => {
    // A quiet score is missing evidence, not evidence of absence. Only a
    // positive reason to believe this was not a drive may delete one.
    const r = scoreDrive({
      observations: [obs("app_opened")],
      availability: { car_bluetooth_connected: "available" },
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.score).toBe(0);
    expect(r.discard).toBe(false);
  });

  it("discounts correlated counter-evidence the same way as positive evidence", () => {
    const r = scoreDrive({
      observations: [obs("walking_track"), obs("low_displacement")],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.score).toBe(-40 + -30 * 0.5);
  });
});

describe("scoreDrive tiers and reasons", () => {
  it("puts a car connection plus highway speed at high confidence", () => {
    const r = scoreDrive({
      observations: [
        obs("car_bluetooth_connected"),
        obs("sustained_vehicle_speed"),
      ],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.score).toBeGreaterThanOrEqual(HIGH_CONFIDENCE);
    expect(r.tier).toBe("high");
    expect(r.reasons).toEqual([]);
  });

  it("puts speed alone from an unknown place in the review tier", () => {
    const r = scoreDrive({
      observations: [obs("sustained_vehicle_speed")],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.tier).toBe("needs_review");
  });

  it("explains a review-tier trip in plain language", () => {
    const r = scoreDrive({
      observations: [obs("geofence_exit")],
      availability: { car_bluetooth_connected: "available" },
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.tier).toBe("insufficient");
    expect(r.reasons).toContain("No car connection detected");
    expect(r.reasons).toContain("Speeds were unusually low for driving");
  });

  it("does not blame a signal the device could never have read", () => {
    // Telling an iPhone user "no car connection detected" when Android
    // Auto does not exist on iOS is noise, not honesty.
    const r = scoreDrive({
      observations: [obs("geofence_exit", { platform: "ios" })],
      availability: { car_audio_route: "unsupported" },
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(r.reasons).not.toContain("No car connection detected");
  });
});

describe("evaluateArm", () => {
  const armed = NOW - m(1);

  it("refuses to start a trip on a confirmation signal alone", () => {
    // The rule the design rests on, in its sharpest form. On iOS the
    // car audio route is the strongest evidence available AND it cannot
    // wake a terminated app, so it must never be what starts a trip.
    // Scoring high is not the same as being allowed to act.
    const r = evaluateArm({
      observations: [obs("car_audio_route", { platform: "ios" })],
      availability: {},
      nowMs: NOW,
      armedAtMs: armed,
      platform: "ios",
    });
    expect(r.action).toBe("stand_down");
    expect(r.refusal).toBe("no_wake_source");
    expect(r.score).toBeGreaterThanOrEqual(START_THRESHOLD);
  });

  it("starts tracking when a wake source fired and the score clears the bar", () => {
    const r = evaluateArm({
      observations: [obs("geofence_exit"), obs("car_bluetooth_connected")],
      availability: {},
      nowMs: NOW,
      armedAtMs: armed,
      platform: "android",
    });
    expect(r.action).toBe("track");
    expect(r.refusal).toBeNull();
  });

  it("holds inside the arm window while the score is still short", () => {
    const r = evaluateArm({
      observations: [obs("geofence_exit")],
      availability: {},
      nowMs: NOW,
      armedAtMs: armed,
      platform: "android",
    });
    expect(r.action).toBe("hold");
  });

  it("stands down once the arm window expires with nothing to show", () => {
    const r = evaluateArm({
      observations: [obs("geofence_exit", { startedAtMs: NOW - m(10) })],
      availability: {},
      nowMs: NOW,
      armedAtMs: NOW - ARM_WINDOW_MS - m(1),
      platform: "android",
    });
    expect(r.action).toBe("stand_down");
    expect(r.refusal).toBe("arm_window_expired");
  });

  it("keeps holding past the window while the car link has not dropped", () => {
    // Sitting in the drive-through or the fuel queue. The producer has
    // gone quiet so the evidence has decayed below the bar, but nothing
    // reported a disconnect, and you do not unpair from your car to buy
    // petrol. Standing down here loses the drive about to resume.
    const r = evaluateArm({
      observations: [
        obs("geofence_enter", { startedAtMs: NOW - m(20) }),
        obs("car_bluetooth_connected", {
          startedAtMs: NOW - m(20),
          lastSeenAtMs: NOW - m(9),
          endedAtMs: null,
        }),
      ],
      availability: {},
      nowMs: NOW,
      armedAtMs: NOW - ARM_WINDOW_MS - m(1),
      platform: "android",
    });
    expect(r.score).toBeLessThan(START_THRESHOLD);
    expect(r.action).toBe("hold");
  });

  it("stands down once the car link actually drops", () => {
    const r = evaluateArm({
      observations: [
        obs("geofence_enter", { startedAtMs: NOW - m(20) }),
        obs("car_bluetooth_connected", {
          startedAtMs: NOW - m(20),
          lastSeenAtMs: NOW - m(9),
          endedAtMs: NOW - m(9),
        }),
      ],
      availability: {},
      nowMs: NOW,
      armedAtMs: NOW - ARM_WINDOW_MS - m(1),
      platform: "android",
    });
    expect(r.action).toBe("stand_down");
    expect(r.refusal).toBe("arm_window_expired");
  });

  it("does not count a wake source the platform cannot produce", () => {
    const r = evaluateArm({
      observations: [obs("boot_completed", { platform: "ios" })],
      availability: {},
      nowMs: NOW,
      armedAtMs: armed,
      platform: "ios",
    });
    expect(r.refusal).toBe("no_wake_source");
  });
});

describe("resolveTripConfidence", () => {
  it("leaves an unevaluated trip exactly as the classifier left it", () => {
    // No signals were readable. Forcing every such trip into review
    // would zero out the deduction on a whole fleet of older builds.
    const unevaluated = scoreDrive({
      observations: [],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(
      resolveTripConfidence({
        confidence: unevaluated,
        autoNeedsConfirmation: false,
        humanClassified: false,
      }),
    ).toMatchObject({ needsConfirmation: false, prune: false });
  });

  it("does not deduct a low-confidence drive until a human confirms it", () => {
    const r = resolveTripConfidence({
      confidence: scoreDrive({
        observations: [obs("car_bluetooth_connected")],
        availability: {},
        referenceMs: NOW,
        phase: "retrospective",
      }),
      autoNeedsConfirmation: false,
      humanClassified: false,
    });
    expect(r.needsConfirmation).toBe(true);
    expect(r.prune).toBe(false);
  });

  it("does not demote a drive when no producer reported anything", () => {
    // Before any native producer ships, the only evidence is the track
    // itself, which is what we already had. Demoting every drive on that
    // basis would turn the whole fleet amber and zero its deductions
    // while adding no information at all.
    const derivedOnly = scoreDrive({
      observations: deriveTrackSignals([
        { lat: 40, lng: -96, ts: NOW, speedMps: 28 },
        { lat: 40, lng: -95.9, ts: NOW + m(4), speedMps: 28 },
        { lat: 40, lng: -95.8, ts: NOW + m(8), speedMps: 28 },
      ]),
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(derivedOnly.deviceEvidence).toBe(false);
    expect(
      resolveTripConfidence({
        confidence: derivedOnly,
        autoNeedsConfirmation: false,
        humanClassified: false,
      }).needsConfirmation,
    ).toBe(false);
  });

  it("still prunes a walk on track evidence alone", () => {
    // Counter-evidence read off the track is the same logic drive-end
    // already uses in the field. It does not need a producer to be
    // trustworthy, and losing it would be a real regression.
    const walk = scoreDrive({
      observations: [obs("walking_track"), obs("low_displacement")],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(walk.deviceEvidence).toBe(false);
    expect(
      resolveTripConfidence({
        confidence: walk,
        autoNeedsConfirmation: false,
        humanClassified: false,
      }).prune,
    ).toBe(true);
  });

  it("leaves a high-confidence drive to the classifier's own verdict", () => {
    const high = scoreDrive({
      observations: [obs("geofence_exit"), obs("sustained_vehicle_speed")],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(
      resolveTripConfidence({
        confidence: high,
        autoNeedsConfirmation: false,
        humanClassified: false,
      }).needsConfirmation,
    ).toBe(false);
  });

  it("keeps the classifier's own review flag even at high confidence", () => {
    // Confident it was a drive is not the same as confident it was
    // business. The two flags mean different things and neither clears
    // the other.
    const high = scoreDrive({
      observations: [obs("geofence_exit"), obs("sustained_vehicle_speed")],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(
      resolveTripConfidence({
        confidence: high,
        autoNeedsConfirmation: true,
        humanClassified: false,
      }).needsConfirmation,
    ).toBe(true);
  });

  it("prunes a candidate the evidence says was not a drive", () => {
    const walk = scoreDrive({
      observations: [
        obs("geofence_exit"),
        obs("walking_track"),
        obs("low_displacement"),
      ],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(
      resolveTripConfidence({
        confidence: walk,
        autoNeedsConfirmation: false,
        humanClassified: false,
      }).prune,
    ).toBe(true);
  });

  it("never prunes or re-flags a drive a person already classified", () => {
    // A human call outranks every machine verdict. Deleting a drive
    // somebody confirmed is the worst thing this code could do.
    const walk = scoreDrive({
      observations: [obs("walking_track"), obs("low_displacement")],
      availability: {},
      referenceMs: NOW,
      phase: "retrospective",
    });
    expect(
      resolveTripConfidence({
        confidence: walk,
        autoNeedsConfirmation: true,
        humanClassified: true,
      }),
    ).toMatchObject({ needsConfirmation: false, prune: false });
  });
});

describe("deriveTrackSignals", () => {
  /** Points heading due east at `mps`, one fix every `stepS` seconds. */
  function track(mps: number, count: number, stepS = 30): GpsPoint[] {
    const out: GpsPoint[] = [];
    for (let i = 0; i < count; i++) {
      const metres = mps * stepS * i;
      out.push({
        lat: 40,
        lng: -96 + metres / (111_320 * Math.cos((40 * Math.PI) / 180)),
        ts: NOW + s(stepS) * i,
        speedMps: mps,
      });
    }
    return out;
  }

  it("returns nothing for a track too short to say anything about", () => {
    expect(deriveTrackSignals(track(20, 1))).toEqual([]);
  });

  it("emits sustained vehicle speed for a highway run", () => {
    const out = deriveTrackSignals(track(28, 20));
    const speed = out.find((o) => o.kind === "sustained_vehicle_speed");
    expect(speed).toBeDefined();
    expect(speed?.strength).toBe(1);
  });

  it("grades a brief burst of driving speed below a long one", () => {
    const brief = deriveTrackSignals(track(28, 4, 30));
    const long = deriveTrackSignals(track(28, 30, 30));
    const bs = brief.find((o) => o.kind === "sustained_vehicle_speed");
    const ls = long.find((o) => o.kind === "sustained_vehicle_speed");
    expect(bs?.strength).toBeLessThan(ls?.strength ?? 0);
  });

  it("emits a walking track for a slow wander with no driving segment", () => {
    const out = deriveTrackSignals(track(1.2, 12));
    expect(out.map((o) => o.kind)).toContain("walking_track");
    expect(out.map((o) => o.kind)).not.toContain("sustained_vehicle_speed");
  });

  it("emits low displacement for a long stay inside a small box", () => {
    const parked: GpsPoint[] = Array.from({ length: 20 }, (_, i) => ({
      lat: 40 + (i % 2) * 0.0002,
      lng: -96,
      ts: NOW + s(60) * i,
      speedMps: 0.2,
    }));
    expect(deriveTrackSignals(parked).map((o) => o.kind)).toContain(
      "low_displacement",
    );
  });

  it("does not call a real drive low displacement just because it was a loop", () => {
    // Out and back to the same place is a normal drive, and the round
    // trip is the whole point of a mileage log.
    const out = track(25, 20, 30);
    const back = out
      .slice()
      .reverse()
      .map((p, i) => ({ ...p, ts: out[out.length - 1].ts + s(30) * (i + 1) }));
    const kinds = deriveTrackSignals([...out, ...back]).map((o) => o.kind);
    expect(kinds).not.toContain("low_displacement");
  });

  it("marks derived observations as spanning the track it read", () => {
    const points = track(28, 20);
    const speed = deriveTrackSignals(points).find(
      (o) => o.kind === "sustained_vehicle_speed",
    );
    expect(speed?.startedAtMs).toBe(points[0].ts);
    expect(speed?.lastSeenAtMs).toBe(points[points.length - 1].ts);
  });

  it("derives speed from position when the device reported none", () => {
    const points: GpsPoint[] = track(28, 20).map((p) => ({
      lat: p.lat,
      lng: p.lng,
      ts: p.ts,
    }));
    expect(deriveTrackSignals(points).map((o) => o.kind)).toContain(
      "sustained_vehicle_speed",
    );
  });
});
