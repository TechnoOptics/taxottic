import { describe, expect, it } from "vitest";
import { evaluateDegradedLadder, type LadderInput } from "./degraded";

const healthy: LadderInput = {
  platform: "android",
  manufacturer: "google",
  trackingEnabled: true,
  locationAuthorization: "always",
  backgroundRefresh: true,
  batteryOptimized: false,
  geofenceStatus: "ok",
  expectedWakeMissed: false,
  motionActivityAuthorization: "authorized",
  signalAvailability: {
    car_bluetooth_connected: "available",
    sustained_vehicle_speed: "available",
  },
};

describe("evaluateDegradedLadder", () => {
  it("says nothing at all when everything is armed", () => {
    // Silence means healthy. A banner that is always up is a banner
    // nobody reads.
    const r = evaluateDegradedLadder(healthy);
    expect(r.worst.rung).toBe(0);
    expect(r.active).toEqual([]);
  });

  it("puts a total location refusal at the top of the ladder", () => {
    const r = evaluateDegradedLadder({
      ...healthy,
      locationAuthorization: "denied",
    });
    expect(r.worst.rung).toBe(7);
    expect(r.worst.surface).toBe("blocking");
    expect(r.worst.action).toBe("manual_add");
  });

  it("never reports tracking as on when location is denied", () => {
    // The bug that made a 21-hour blackout invisible: the toggle said ON
    // while the system was dead.
    const r = evaluateDegradedLadder({
      ...healthy,
      trackingEnabled: true,
      locationAuthorization: "denied",
    });
    expect(r.trackingTruthfullyOn).toBe(false);
  });

  it("reports tracking as on when it is both enabled and armed", () => {
    expect(evaluateDegradedLadder(healthy).trackingTruthfullyOn).toBe(true);
  });

  it("flags an iOS downgrade from Always to While Using", () => {
    const r = evaluateDegradedLadder({
      ...healthy,
      platform: "ios",
      locationAuthorization: "whenInUse",
    });
    expect(r.worst.rung).toBe(3);
    expect(r.worst.surface).toBe("blocking");
    expect(r.worst.action).toBe("location_settings");
    expect(r.trackingTruthfullyOn).toBe(false);
  });

  it("flags Background App Refresh being off by name", () => {
    // SLC and geofences both go silent with no error when this is off.
    const r = evaluateDegradedLadder({
      ...healthy,
      platform: "ios",
      backgroundRefresh: false,
    });
    expect(r.worst.rung).toBe(4);
    expect(r.worst.headline).toContain("Background App Refresh");
  });

  it("flags Android battery optimisation with a settings action", () => {
    const r = evaluateDegradedLadder({ ...healthy, batteryOptimized: true });
    expect(r.worst.rung).toBe(5);
    expect(r.worst.action).toBe("battery_optimization");
  });

  it("names Samsung sleeping apps when the handset is a Samsung", () => {
    // No API reports this state, so it can only be inferred and told to
    // the user. Samsung re-enables it after firmware updates.
    const r = evaluateDegradedLadder({
      ...healthy,
      manufacturer: "samsung",
      batteryOptimized: true,
    });
    expect(r.worst.detail).toContain("Sleeping apps");
    expect(r.worst.action).toBe("oem_wizard");
  });

  it("reports a missed expected wake as a suspected blackout", () => {
    const r = evaluateDegradedLadder({
      ...healthy,
      expectedWakeMissed: true,
    });
    expect(r.worst.rung).toBe(6);
    expect(r.worst.action).toBe("manual_add");
  });

  it("reports running without any vehicle signal rather than hiding it", () => {
    const r = evaluateDegradedLadder({ ...healthy, signalAvailability: {} });
    expect(r.worst.rung).toBe(1);
    expect(r.active.map((d) => d.id)).toContain("no_vehicle_signals");
  });

  it("treats a denied car-signal permission as a visible rung", () => {
    const r = evaluateDegradedLadder({
      ...healthy,
      signalAvailability: {
        car_bluetooth_connected: "permission_denied",
        sustained_vehicle_speed: "available",
      },
    });
    expect(r.active.map((d) => d.id)).toContain("no_car_signal");
    expect(r.worst.rung).toBe(1);
  });

  it("records a policy-blocked signal without nagging about it", () => {
    // ACTIVITY_RECOGNITION is refused by Play policy on purpose. It is a
    // supported path, not a break, but it still has to be inspectable.
    const r = evaluateDegradedLadder({
      ...healthy,
      signalAvailability: {
        ...healthy.signalAvailability,
        motion_activity_automotive: "policy_blocked",
      },
    });
    const rung = r.active.find((d) => d.rung === 2);
    expect(rung).toBeDefined();
    expect(rung?.surface).toBe("silent");
  });

  it("keeps every active rung, not just the worst one", () => {
    const r = evaluateDegradedLadder({
      ...healthy,
      platform: "ios",
      backgroundRefresh: false,
      expectedWakeMissed: true,
      signalAvailability: {},
    });
    expect(r.worst.rung).toBe(6);
    expect(r.active.map((d) => d.rung).sort()).toEqual([1, 4, 6]);
  });

  it("reports a broken geofence mesh even while permissions look fine", () => {
    const r = evaluateDegradedLadder({ ...healthy, geofenceStatus: "broken" });
    expect(r.active.map((d) => d.id)).toContain("wake_mesh_broken");
    expect(r.trackingTruthfullyOn).toBe(false);
  });

  it("treats an unknown device state as degraded, never as healthy", () => {
    // An app build older than the heartbeat fields reports null. Reading
    // that as health is exactly how silent failure survives.
    const r = evaluateDegradedLadder({
      ...healthy,
      locationAuthorization: null,
      backgroundRefresh: null,
      batteryOptimized: null,
      geofenceStatus: null,
      signalAvailability: {},
    });
    expect(r.worst.rung).toBeGreaterThan(0);
  });

  it("says the gap audit is blind when Motion access was never granted", () => {
    // The iOS gap audit only runs when Motion is already authorized, and
    // never prompts. Left unsaid, an inert audit looks exactly like a
    // clean record of no missed drives.
    const r = evaluateDegradedLadder({
      ...healthy,
      platform: "ios",
      motionActivityAuthorization: "notDetermined",
    });
    expect(r.active.map((d) => d.id)).toContain("gap_audit_unavailable");
    expect(r.worst.rung).toBeGreaterThan(0);
  });

  it("does not ask Android for a Motion grant that iOS alone uses", () => {
    const r = evaluateDegradedLadder({
      ...healthy,
      platform: "android",
      motionActivityAuthorization: "notDetermined",
    });
    expect(r.active.map((d) => d.id)).not.toContain("gap_audit_unavailable");
  });

  it("ranks a detected-but-lost drive above every other unhealthy state", () => {
    // We saw the car connect, we knew a drive was starting, and the
    // permission stopped us acting on it. That is a proven loss, not a
    // configuration worry, and it outranks even a total location refusal
    // because it comes with evidence that a real drive went missing.
    const r = evaluateDegradedLadder({
      ...healthy,
      locationAuthorization: "denied",
      wakeOutcomes: ["blocked_no_background_permission"],
    });
    expect(r.worst.id).toBe("wake_blocked_permission");
    expect(r.worst.surface).toBe("blocking");
    expect(r.trackingTruthfullyOn).toBe(false);
  });

  it("flags a refused service start as an Android power-management problem", () => {
    const r = evaluateDegradedLadder({
      ...healthy,
      wakeOutcomes: ["blocked_service_start_denied"],
    });
    expect(r.active.map((d) => d.id)).toContain("wake_service_denied");
  });

  it("says nothing when the wake actually started the tracker", () => {
    const r = evaluateDegradedLadder({
      ...healthy,
      wakeOutcomes: ["started", "already_running"],
    });
    expect(r.active).toEqual([]);
  });

  it("says tracking is off, not degraded, when the user turned it off", () => {
    const r = evaluateDegradedLadder({ ...healthy, trackingEnabled: false });
    expect(r.trackingTruthfullyOn).toBe(false);
    expect(r.worst.rung).toBe(0);
    expect(r.active).toEqual([]);
  });
});
