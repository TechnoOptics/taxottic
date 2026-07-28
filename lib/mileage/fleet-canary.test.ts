import { describe, it, expect } from "vitest";
import { evaluateFleetCapture, type FleetDay } from "./fleet-canary";

const day = (
  d: string,
  points: number,
  activeDrivers: number,
  trips = 3,
): FleetDay => ({ day: d, points, activeDrivers, trips });

// A healthy fleet: ~1000 points/day from 2 drivers.
const healthy = [
  day("2026-07-20", 1000, 2),
  day("2026-07-21", 1100, 2),
  day("2026-07-22", 900, 2),
  day("2026-07-23", 1050, 2),
  day("2026-07-24", 950, 2),
];

describe("evaluateFleetCapture", () => {
  it("a normal day is ok", () => {
    expect(evaluateFleetCapture(day("2026-07-25", 980, 2), healthy).status).toBe(
      "ok",
    );
  });

  it("a busy day is ok (never alarms on MORE capture)", () => {
    expect(
      evaluateFleetCapture(day("2026-07-25", 4000, 2), healthy).status,
    ).toBe("ok");
  });

  it("CRITICAL: total fleet silence", () => {
    // The 'our devices have not tracked our drives this whole week'
    // incident — caught on day one instead of day six.
    const v = evaluateFleetCapture(day("2026-07-25", 0, 0), healthy);
    expect(v.status).toBe("critical");
    expect(v.reason).toContain("fully down");
  });

  it("CRITICAL: most devices stopped reporting", () => {
    const v = evaluateFleetCapture(day("2026-07-25", 400, 0, 1), healthy);
    expect(v.status).toBe("critical");
  });

  it("CRITICAL: points flow but NOTHING becomes a trip (pipeline broke)", () => {
    // Devices are perfect; segmentation or the finalizer regressed.
    // Invisible to every per-device check we have.
    const v = evaluateFleetCapture(day("2026-07-25", 1000, 2, 0), healthy);
    expect(v.status).toBe("critical");
    expect(v.reason).toContain("ZERO trips");
  });

  it("WARN: capture halved but not collapsed", () => {
    const v = evaluateFleetCapture(day("2026-07-25", 450, 2), healthy);
    expect(v.status).toBe("warn");
  });

  it("stays quiet without enough baseline history", () => {
    const v = evaluateFleetCapture(day("2026-07-25", 0, 0), [
      day("2026-07-24", 1000, 2),
    ]);
    expect(v.status).toBe("ok");
  });

  it("stays quiet when the baseline itself is too quiet to judge", () => {
    const quiet = [
      day("2026-07-20", 5, 1),
      day("2026-07-21", 3, 1),
      day("2026-07-22", 4, 1),
    ];
    expect(evaluateFleetCapture(day("2026-07-25", 0, 0), quiet).status).toBe(
      "ok",
    );
  });

  it("uses the MEDIAN so one road-trip day cannot mask a real drop", () => {
    const withOutlier = [
      day("2026-07-20", 1000, 2),
      day("2026-07-21", 1000, 2),
      day("2026-07-22", 20000, 2), // cross-country drive
      day("2026-07-23", 1000, 2),
    ];
    // 450 is >50% of the 1000 median (ok), but only ~2% of a ~5750 mean,
    // which would have fired a false critical.
    expect(
      evaluateFleetCapture(day("2026-07-25", 600, 2), withOutlier).status,
    ).toBe("ok");
  });

  it("a weekend of no driving does not alarm when drivers still report", () => {
    // Points drop with less driving, but both devices are alive and the
    // ratio stays above the warn floor.
    expect(
      evaluateFleetCapture(day("2026-07-26", 700, 2), healthy).status,
    ).toBe("ok");
  });
});
