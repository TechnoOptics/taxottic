import { describe, expect, it } from "vitest";
import {
  SIGNAL_REGISTRY,
  isWakeSource,
  parseSignalReport,
  signalDefinition,
  signalTier,
  wakeSourcesFor,
  type SignalKind,
} from "./signals";

const NOW = 1_800_000_000_000;
const m = (n: number) => n * 60_000;

describe("signalTier", () => {
  it("reports the learned-place geofence exit as a wake source on both platforms", () => {
    expect(signalTier("geofence_exit", "ios")).toBe("wake");
    expect(signalTier("geofence_exit", "android")).toBe("wake");
  });

  it("reports car bluetooth as confirmation-only on iOS, where classic BT cannot wake us", () => {
    expect(signalTier("car_audio_route", "ios")).toBe("confirmation");
  });

  it("reports car bluetooth as a wake source on Android, where it was proven on a handset", () => {
    // The ACL broadcast does reach a manifest receiver in a killed
    // process. This is the one vehicle signal anywhere in the design
    // that is allowed to start a trip, and only here.
    expect(signalTier("car_bluetooth_connected", "android")).toBe("wake");
  });

  it("returns null for a kind that does not exist on the platform", () => {
    expect(signalTier("android_auto_connected", "ios")).toBeNull();
    expect(signalTier("car_audio_route", "android")).toBeNull();
  });

  it("returns null on web, which observes no vehicle signals at all", () => {
    expect(signalTier("sustained_vehicle_speed", "web")).toBeNull();
  });
});

describe("SIGNAL_REGISTRY invariants", () => {
  it("gives every kind a weight, a half-life and a correlation group", () => {
    for (const [kind, def] of Object.entries(SIGNAL_REGISTRY)) {
      expect(def.kind, `${kind} kind mismatch`).toBe(kind);
      expect(Number.isFinite(def.weight), `${kind} weight`).toBe(true);
      expect(def.halfLifeMs, `${kind} half-life`).toBeGreaterThan(0);
      expect(def.group.length, `${kind} group`).toBeGreaterThan(0);
    }
  });

  it("never lets a device-reported kind carry counter-evidence weight", () => {
    // Negative weight is derived server-side from the track. A device that
    // could post it could suppress its own drives.
    for (const def of Object.values(SIGNAL_REGISTRY)) {
      if (def.weight < 0) expect(def.origin).toBe("derived");
    }
  });

  it("never declares a derived, server-computed kind as a wake source", () => {
    // A wake source is an OS event that starts our process. Nothing the
    // server computes after the fact can do that.
    for (const def of Object.values(SIGNAL_REGISTRY)) {
      if (def.origin !== "derived") continue;
      expect(def.tier.ios).not.toBe("wake");
      expect(def.tier.android).not.toBe("wake");
    }
  });

  it("keeps the iOS wake list to CoreLocation events only", () => {
    // A terminated iOS app runs no code. SLC, region monitoring and visits
    // are the entire set; anything else here is a design regression.
    expect(wakeSourcesFor("ios").sort()).toEqual(
      [
        "app_opened",
        "geofence_enter",
        "geofence_exit",
        "significant_location_change",
        "visit_departure",
      ].sort(),
    );
  });

  it("keeps the Android wake list to geofence and process-restart events", () => {
    expect(wakeSourcesFor("android").sort()).toEqual(
      [
        "app_opened",
        "boot_completed",
        "car_bluetooth_connected",
        "geofence_enter",
        "geofence_exit",
        "significant_location_change",
      ].sort(),
    );
  });

  it("excludes every vehicle-presence signal from the iOS wake list", () => {
    // The rule the whole design rests on. On iOS the strongest evidence
    // we have cannot start anything: classic car audio is invisible to
    // CoreBluetooth, and a terminated app runs no code.
    const presence: SignalKind[] = [
      "car_bluetooth_connected",
      "car_audio_route",
      "android_auto_connected",
    ];
    for (const kind of presence) {
      expect(isWakeSource(kind, "ios")).toBe(false);
    }
  });

  it("does not treat Android Auto or a car audio route as a wake source", () => {
    // Only the Bluetooth ACL broadcast was proven to start a dead
    // process. Projection and audio-route were not, and inheriting the
    // promotion would be assuming what was never tested.
    expect(isWakeSource("android_auto_connected", "android")).toBe(false);
    expect(isWakeSource("car_audio_route", "ios")).toBe(false);
  });

  it("keeps the platforms asymmetric, which is the whole point", () => {
    // Android proved a manifest receiver starts a dead process on an ACL
    // connect; iOS has no equivalent and never will. A design that
    // assumed symmetry would work on the owner's Samsung and do nothing
    // on the other driver's iPhone.
    expect(signalTier("car_bluetooth_connected", "android")).toBe("wake");
    expect(signalTier("car_bluetooth_connected", "ios")).toBeNull();
    expect(signalTier("car_audio_route", "ios")).toBe("confirmation");
  });
});

describe("parseSignalReport", () => {
  const wire = (over: Record<string, unknown> = {}) => ({
    kind: "car_bluetooth_connected",
    platform: "android",
    startedAtMs: NOW - m(5),
    lastSeenAtMs: NOW - m(1),
    endedAtMs: null,
    ...over,
  });

  it("accepts a well-formed device observation", () => {
    const r = parseSignalReport({ observations: [wire()] }, NOW);
    expect(r.observations).toEqual([
      {
        kind: "car_bluetooth_connected",
        platform: "android",
        startedAtMs: NOW - m(5),
        lastSeenAtMs: NOW - m(1),
        endedAtMs: null,
        detail: null,
      },
    ]);
    expect(r.rejected).toEqual([]);
  });

  it("records an unknown kind as a rejection instead of dropping it", () => {
    const r = parseSignalReport(
      { observations: [wire({ kind: "telepathy" })] },
      NOW,
    );
    expect(r.observations).toEqual([]);
    expect(r.rejected).toEqual([
      { kind: "telepathy", reason: "unknown_kind" },
    ]);
  });

  it("rejects a signal the platform cannot produce", () => {
    const r = parseSignalReport(
      { observations: [wire({ kind: "android_auto_connected", platform: "ios" })] },
      NOW,
    );
    expect(r.rejected).toEqual([
      { kind: "android_auto_connected", reason: "unsupported_on_platform" },
    ]);
  });

  it("rejects a derived kind arriving from a device", () => {
    const r = parseSignalReport(
      { observations: [wire({ kind: "walking_track" })] },
      NOW,
    );
    expect(r.observations).toEqual([]);
    expect(r.rejected).toEqual([
      { kind: "walking_track", reason: "not_device_reportable" },
    ]);
  });

  it("rejects a timestamp from the future, which is clock poisoning", () => {
    const r = parseSignalReport(
      { observations: [wire({ lastSeenAtMs: NOW + m(30) })] },
      NOW,
    );
    expect(r.rejected).toEqual([
      { kind: "car_bluetooth_connected", reason: "future_timestamp" },
    ]);
  });

  it("rejects an observation whose end precedes its start", () => {
    const r = parseSignalReport(
      {
        observations: [
          wire({ startedAtMs: NOW - m(1), endedAtMs: NOW - m(9) }),
        ],
      },
      NOW,
    );
    expect(r.rejected).toEqual([
      { kind: "car_bluetooth_connected", reason: "malformed" },
    ]);
  });

  it("keeps a declared availability verdict for every kind the device named", () => {
    const r = parseSignalReport(
      {
        observations: [],
        availability: {
          car_bluetooth_connected: "permission_denied",
          android_auto_connected: "unsupported",
        },
      },
      NOW,
    );
    expect(r.availability).toEqual({
      car_bluetooth_connected: "permission_denied",
      android_auto_connected: "unsupported",
    });
  });

  it("records an unrecognised availability verdict as unknown rather than available", () => {
    // Absence of a verdict must never read as health. An app build older
    // than a signal reports nothing for it.
    const r = parseSignalReport(
      { observations: [], availability: { car_bluetooth_connected: "fine" } },
      NOW,
    );
    expect(r.availability).toEqual({ car_bluetooth_connected: "unknown" });
  });

  it("returns an empty report for junk input rather than throwing", () => {
    expect(parseSignalReport(null, NOW)).toEqual({
      observations: [],
      availability: {},
      rejected: [],
    });
    expect(parseSignalReport({ observations: "nope" }, NOW)).toEqual({
      observations: [],
      availability: {},
      rejected: [],
    });
  });

  it("caps the number of observations it will accept from one payload", () => {
    const many = Array.from({ length: 500 }, () => wire());
    const r = parseSignalReport({ observations: many }, NOW);
    expect(r.observations.length).toBe(64);
    expect(r.rejected.at(-1)).toEqual({
      kind: null,
      reason: "too_many_observations",
    });
  });
});

describe("signalDefinition", () => {
  it("weights sustained road speed above a car bluetooth link", () => {
    // Deliberate departure from the design doc's 45-over-40. Bluetooth
    // proves proximity to a car; a parked car with the accessories on
    // holds the link all evening. Sustained road speed proves travel.
    // This engine detects travel, so speed leads.
    expect(signalDefinition("sustained_vehicle_speed").weight).toBeGreaterThan(
      signalDefinition("car_bluetooth_connected").weight,
    );
  });

  it("keeps any single signal below the high-confidence bar on its own", () => {
    // No one signal may ever mark a drive confirmed by itself. A
    // deduction needs corroboration.
    for (const def of Object.values(SIGNAL_REGISTRY)) {
      expect(def.weight).toBeLessThan(70);
    }
  });

  it("weights any single ambient signal below the start threshold on its own", () => {
    for (const def of Object.values(SIGNAL_REGISTRY)) {
      if (def.group !== "ambient") continue;
      expect(def.weight).toBeLessThan(35);
    }
  });

  it("marks the seven-day motion history as usable only in retrospect", () => {
    expect(signalDefinition("motion_history_automotive").availableAt).toBe(
      "retrospective",
    );
  });
});
