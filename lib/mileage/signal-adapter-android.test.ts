import { describe, expect, it } from "vitest";
import {
  foldCarSignalEvents,
  type AndroidCarSignalEvent,
} from "./signal-adapter";
import { START_THRESHOLD, evaluateArm, scoreDrive } from "./confidence";

const BOOT = 1_799_000_000_000;
const NOW = 1_800_000_000_000;
const m = (n: number) => n * 60_000;

function ev(
  over: Partial<AndroidCarSignalEvent> & { atMs: number },
): AndroidCarSignalEvent {
  return {
    kind: "bluetooth",
    state: "connected",
    elapsedRealtimeMs: over.atMs - BOOT,
    bootAtMs: BOOT,
    vehicleClass: true,
    ...over,
  };
}

const opts = { platform: "android" as const, nowMs: NOW, bootMs: BOOT };

describe("foldCarSignalEvents: vehicle class gate", () => {
  it("folds a car bluetooth connect into a scoring observation", () => {
    const r = foldCarSignalEvents(
      [ev({ atMs: NOW - m(10), deviceName: "Ford SYNC" })],
      opts,
    );
    expect(r.observations).toHaveLength(1);
    expect(r.observations[0]).toMatchObject({
      kind: "car_bluetooth_connected",
      platform: "android",
      startedAtMs: NOW - m(10),
      endedAtMs: null,
    });
  });

  it("never lets headphones contribute vehicle evidence", () => {
    // vehicleClass is true only for car_audio and handsfree. Everything
    // else reaches the log and must score nothing, or every commute with
    // earbuds in becomes a drive.
    const r = foldCarSignalEvents(
      [ev({ atMs: NOW - m(5), vehicleClass: false, deviceName: "AirPods" })],
      opts,
    );
    expect(r.observations).toEqual([]);
    expect(r.nonVehicleFiltered).toBe(1);
  });

  it("counts filtered non-vehicle devices rather than discarding the fact", () => {
    const r = foldCarSignalEvents(
      [
        ev({ atMs: NOW - m(9), vehicleClass: false }),
        ev({ atMs: NOW - m(8), vehicleClass: false }),
      ],
      opts,
    );
    expect(r.nonVehicleFiltered).toBe(2);
    expect(r.rejected).toEqual([]);
  });

  it("closes the interval on a disconnect", () => {
    const r = foldCarSignalEvents(
      [
        ev({ atMs: NOW - m(30), state: "connected" }),
        ev({ atMs: NOW - m(4), state: "disconnected" }),
      ],
      opts,
    );
    expect(r.observations[0]).toMatchObject({
      startedAtMs: NOW - m(30),
      endedAtMs: NOW - m(4),
    });
  });
});

describe("foldCarSignalEvents: kinds", () => {
  it("maps a projection session to Android Auto", () => {
    const r = foldCarSignalEvents(
      [
        ev({
          atMs: NOW - m(6),
          kind: "projection",
          projectionType: "android_auto",
        }),
      ],
      opts,
    );
    expect(r.observations[0].kind).toBe("android_auto_connected");
  });

  it("maps a power connect to charging", () => {
    const r = foldCarSignalEvents(
      [ev({ atMs: NOW - m(2), kind: "power", plugged: true })],
      opts,
    );
    expect(r.observations[0].kind).toBe("charging_connected");
  });

  it("does not gate charging or projection on the bluetooth vehicle class", () => {
    // vehicleClass describes a bluetooth device class. It is meaningless
    // for a USB charger and must not silently suppress it.
    const r = foldCarSignalEvents(
      [
        ev({
          atMs: NOW - m(2),
          kind: "power",
          plugged: true,
          vehicleClass: false,
        }),
      ],
      opts,
    );
    expect(r.observations[0].kind).toBe("charging_connected");
  });
});

describe("foldCarSignalEvents: the platform asymmetry", () => {
  it("lets an Android car bluetooth connect start a trip on its own", () => {
    // Proven on a handset: the manifest receiver starts a dead process.
    // This is the one place a vehicle signal may be load-bearing.
    const r = foldCarSignalEvents([ev({ atMs: NOW })], opts);
    const decision = evaluateArm({
      observations: r.observations,
      availability: {},
      nowMs: NOW,
      armedAtMs: NOW - m(1),
      platform: "android",
    });
    expect(decision.action).toBe("track");
    expect(decision.score).toBeGreaterThanOrEqual(START_THRESHOLD);
  });

  it("rejects a car bluetooth event claimed by an iOS device", () => {
    const r = foldCarSignalEvents([ev({ atMs: NOW })], {
      ...opts,
      platform: "ios",
    });
    expect(r.observations).toEqual([]);
    expect(r.rejected).toEqual([
      { kind: "car_bluetooth_connected", reason: "unsupported_on_platform" },
    ]);
  });
});

describe("foldCarSignalEvents: clocks", () => {
  it("prefers the monotonic clock inside one boot epoch", () => {
    const trueTs = NOW - m(7);
    const r = foldCarSignalEvents(
      [ev({ atMs: trueTs - m(90), elapsedRealtimeMs: trueTs - BOOT })],
      opts,
    );
    expect(r.observations[0].startedAtMs).toBe(trueTs);
    expect(r.clockCorrections).toBe(1);
  });

  it("falls back to wall clock across a reboot, where monotonic is meaningless", () => {
    // Different bootAtMs means the monotonic origin changed. Differencing
    // across it would fabricate hours of age.
    const r = foldCarSignalEvents(
      [ev({ atMs: NOW - m(3), bootAtMs: BOOT - m(9999), elapsedRealtimeMs: 5 })],
      opts,
    );
    expect(r.observations[0].startedAtMs).toBe(NOW - m(3));
    expect(r.clockCorrections).toBe(0);
  });
});

describe("foldCarSignalEvents: wake outcomes", () => {
  it("surfaces a detected drive that was lost to a missing permission", () => {
    // The worst state in the system: we saw the car connect, we knew a
    // drive was starting, and we could not act on it.
    const r = foldCarSignalEvents(
      [
        ev({
          atMs: NOW - m(20),
          wakeAttempted: true,
          wakeOutcome: "blocked_no_background_permission",
        }),
      ],
      opts,
    );
    expect(r.wakeOutcomes).toEqual(["blocked_no_background_permission"]);
  });

  it("reports which wake source actually carried the drive", () => {
    const r = foldCarSignalEvents(
      [ev({ atMs: NOW - m(20), wakeAttempted: true, wakeOutcome: "started" })],
      opts,
    );
    expect(r.wakeOutcomes).toEqual(["started"]);
  });

  it("still scores the observation when the wake was blocked", () => {
    // A blocked wake is a capture failure, not a reason to disbelieve
    // that the car connected.
    const r = foldCarSignalEvents(
      [
        ev({
          atMs: NOW,
          wakeOutcome: "blocked_service_start_denied",
        }),
      ],
      opts,
    );
    expect(
      scoreDrive({
        observations: r.observations,
        availability: {},
        referenceMs: NOW,
        phase: "live",
      }).score,
    ).toBe(45);
  });

  it("returns an empty fold for an empty ring", () => {
    expect(foldCarSignalEvents([], opts)).toEqual({
      observations: [],
      gaps: [],
      rejected: [],
      clockCorrections: 0,
      wakeOutcomes: [],
      nonVehicleFiltered: 0,
    });
  });
});
