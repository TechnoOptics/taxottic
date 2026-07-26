import { describe, it, expect } from "vitest";
import {
  evaluateDriveEnd,
  STEP_CLOSE_THRESHOLD,
  STATIONARY_CLOSE_MS,
} from "./drive-end";

describe("evaluateDriveEnd", () => {
  it("never closes a session that never drove", () => {
    expect(
      evaluateDriveEnd({ hasDriven: false, stationaryMs: 999_999, stepsSinceStationary: 100 }),
    ).toEqual({ close: false, reason: null });
  });

  it("does not close while still moving", () => {
    expect(
      evaluateDriveEnd({ hasDriven: true, stationaryMs: 0, stepsSinceStationary: 0 }),
    ).toEqual({ close: false, reason: null });
  });

  it("closes immediately when the driver walks away (steps >= threshold)", () => {
    expect(
      evaluateDriveEnd({
        hasDriven: true,
        stationaryMs: 20_000, // only 20s parked — far under the timeout
        stepsSinceStationary: STEP_CLOSE_THRESHOLD,
      }),
    ).toEqual({ close: true, reason: "walked_away" });
  });

  it("does NOT close at a red light: stationary but no walking, under timeout", () => {
    expect(
      evaluateDriveEnd({
        hasDriven: true,
        stationaryMs: 90_000, // 90s at a light
        stepsSinceStationary: 3, // a couple of fidgety steps
      }),
    ).toEqual({ close: false, reason: null });
  });

  it("closes via the stationary fallback when parked with no steps", () => {
    expect(
      evaluateDriveEnd({
        hasDriven: true,
        stationaryMs: STATIONARY_CLOSE_MS,
        stepsSinceStationary: 0, // phone left in the car
      }),
    ).toEqual({ close: true, reason: "stationary_timeout" });
  });

  it("walk-away wins over the timer even a moment after stopping", () => {
    expect(
      evaluateDriveEnd({
        hasDriven: true,
        stationaryMs: STATIONARY_CLOSE_MS - 1,
        stepsSinceStationary: STEP_CLOSE_THRESHOLD + 5,
      }),
    ).toEqual({ close: true, reason: "walked_away" });
  });

  it("just under the step threshold does not close early", () => {
    expect(
      evaluateDriveEnd({
        hasDriven: true,
        stationaryMs: 60_000,
        stepsSinceStationary: STEP_CLOSE_THRESHOLD - 1,
      }),
    ).toEqual({ close: false, reason: null });
  });
});

// GPS walk-away (permission-free). Android 1.3.0 has no step counter
// (Play policy), so this is its only fast close; it also backs up steps
// on iOS. Sustained walking-band fixes drifting >45 m from the park
// point mean the driver left the car.
describe("gps_walk close", () => {
  // Armed + off-axis: the post-2026-07-26 contract. A real park (45s
  // hard stop) arms the detector; the walker's path diverges from the
  // road. Both were missing when highway stop-and-go closed two real
  // drives mid-motion.
  const base = {
    hasDriven: true,
    stationaryMs: 90_000,
    stepsSinceStationary: 0,
    walkArmed: true,
    walkBearingDeltaDeg: 90,
  };

  it("closes on sustained walking displacement (Android's fast path)", () => {
    const d = evaluateDriveEnd({ ...base, walkDisplacementM: 60, walkingFixCount: 4 });
    expect(d).toEqual({ close: true, reason: "gps_walk" });
  });

  it("HIGHWAY REGRESSION: unarmed walking-band creep never closes", () => {
    // Jul 26 field failure: stop-and-go traffic creeps at walking pace.
    // No 45s hard stop ever happened, so the detector must stay silent
    // no matter how much band-speed displacement accumulates.
    const d = evaluateDriveEnd({
      ...base,
      walkArmed: false,
      walkDisplacementM: 300,
      walkingFixCount: 12,
    });
    expect(d.close).toBe(false);
  });

  it("HIGHWAY REGRESSION: armed but creeping ALONG the road never closes", () => {
    // Gridlock with real 45s+ stops still creeps along the driving
    // heading. On-axis movement is traffic, not a walker.
    const d = evaluateDriveEnd({
      ...base,
      walkBearingDeltaDeg: 8,
      walkDisplacementM: 200,
      walkingFixCount: 8,
    });
    expect(d.close).toBe(false);
  });

  it("no known heading: closes only past the long displacement floor", () => {
    const near = evaluateDriveEnd({
      ...base,
      walkBearingDeltaDeg: null,
      walkDisplacementM: 90,
      walkingFixCount: 5,
    });
    expect(near.close).toBe(false);
    const far = evaluateDriveEnd({
      ...base,
      walkBearingDeltaDeg: null,
      walkDisplacementM: 150,
      walkingFixCount: 5,
    });
    expect(far).toEqual({ close: true, reason: "gps_walk" });
  });

  it("displacement without enough walking fixes does NOT close (one bad fix)", () => {
    const d = evaluateDriveEnd({ ...base, walkDisplacementM: 80, walkingFixCount: 1 });
    expect(d.close).toBe(false);
  });

  it("walking fixes without displacement does NOT close (pacing by the car)", () => {
    const d = evaluateDriveEnd({ ...base, walkDisplacementM: 20, walkingFixCount: 6 });
    expect(d.close).toBe(false);
  });

  it("steps still win when both signals present (fastest first)", () => {
    const d = evaluateDriveEnd({
      ...base,
      stepsSinceStationary: 25,
      walkDisplacementM: 60,
      walkingFixCount: 4,
    });
    expect(d).toEqual({ close: true, reason: "walked_away" });
  });

  it("red light: no steps, no walk signal, under timer → stays open", () => {
    const d = evaluateDriveEnd({ ...base, walkDisplacementM: 0, walkingFixCount: 0 });
    expect(d.close).toBe(false);
  });

  it("absent walk fields (old callers) behave exactly as before", () => {
    expect(evaluateDriveEnd(base).close).toBe(false);
  });
});
