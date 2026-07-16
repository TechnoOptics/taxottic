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
