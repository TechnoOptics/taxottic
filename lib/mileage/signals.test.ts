import { describe, expect, it } from "vitest";
import {
  MAX_OBSERVATIONS_PER_REPORT,
  SIGNAL_REGISTRY,
  isSignalKind,
  parseSignalReport,
  signalTier,
  type SignalObservation,
} from "./signals";

const NOW = 1_800_000_000_000;
const m = (n: number) => n * 60_000;

function wire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "car_audio_route",
    platform: "ios",
    startedAtMs: NOW - m(20),
    lastSeenAtMs: NOW - m(2),
    endedAtMs: null,
    source: "event",
    ...over,
  };
}

describe("the registry", () => {
  it("lists only signals a native producer can actually emit today", () => {
    // Guards the guard: an empty registry would make every tier check
    // below vacuously true.
    expect(Object.keys(SIGNAL_REGISTRY).length).toBeGreaterThan(3);
  });

  it("says web produces no signals at all", () => {
    for (const kind of Object.keys(SIGNAL_REGISTRY)) {
      expect(signalTier(kind as never, "web"), kind).toBeNull();
    }
  });

  it("keeps the two platforms asymmetric where the OS is", () => {
    // The asymmetry is real and load-bearing, not an oversight. Classic
    // car audio is invisible to CoreBluetooth on iOS, and Android has no
    // AVAudioSession route to read.
    expect(signalTier("car_audio_route", "ios")).not.toBeNull();
    expect(signalTier("car_audio_route", "android")).toBeNull();
    expect(signalTier("car_bluetooth_connected", "android")).not.toBeNull();
    expect(signalTier("car_bluetooth_connected", "ios")).toBeNull();
  });

  it("makes car Bluetooth the only wake-capable confirmation signal", () => {
    // Everything else here is evaluated once we are already awake and can
    // never start a trip. If a second kind acquires "wake" it must be
    // because a device test proved the OS launches us for it.
    const wake = Object.values(SIGNAL_REGISTRY)
      .filter((d) => d.tier.ios === "wake" || d.tier.android === "wake")
      .map((d) => d.kind);
    expect(wake).toEqual(["car_bluetooth_connected"]);
  });

  it("recognises its own kinds and nothing else", () => {
    expect(isSignalKind("car_audio_route")).toBe(true);
    expect(isSignalKind("walking_track")).toBe(false);
    expect(isSignalKind(42)).toBe(false);
  });
});

describe("parseSignalReport", () => {
  it("accepts a well-formed observation", () => {
    const r = parseSignalReport({ observations: [wire()] }, NOW);
    expect(r.rejected).toEqual([]);
    expect(r.observations).toHaveLength(1);
    expect(r.observations[0]).toMatchObject({
      kind: "car_audio_route",
      platform: "ios",
      startedAtMs: NOW - m(20),
      lastSeenAtMs: NOW - m(2),
      endedAtMs: null,
    });
  });

  it("preserves source, because poll and event are not the same claim", () => {
    // THE LOSSY PIPE THIS TEST EXISTS TO PREVENT.
    //
    // A poll at 08:14 says "connected when we looked". It is NOT evidence
    // that the car connected at 08:14, and a car parked all evening with
    // the accessories on polls exactly like one that just started. The
    // adapter draws that distinction and this parser is the only thing
    // between it and the database; dropping the field would silently
    // turn every stale reading into a fresh one.
    const r = parseSignalReport(
      { observations: [wire({ source: "poll" })] },
      NOW,
    );
    expect(r.observations[0].source).toBe("poll");
  });

  it("drops a source it does not recognise rather than storing it", () => {
    const r = parseSignalReport(
      { observations: [wire({ source: "vibes" })] },
      NOW,
    );
    expect(r.observations[0].source).toBeUndefined();
  });

  it("rejects a kind it has never heard of, by name", () => {
    const r = parseSignalReport(
      { observations: [wire({ kind: "telepathy" })] },
      NOW,
    );
    expect(r.observations).toEqual([]);
    expect(r.rejected).toEqual([{ kind: "telepathy", reason: "unknown_kind" }]);
  });

  it("rejects a signal the claimed platform cannot produce", () => {
    const r = parseSignalReport(
      { observations: [wire({ platform: "android" })] },
      NOW,
    );
    expect(r.rejected).toEqual([
      { kind: "car_audio_route", reason: "unsupported_on_platform" },
    ]);
  });

  it("rejects a timestamp from the future", () => {
    const r = parseSignalReport(
      { observations: [wire({ lastSeenAtMs: NOW + m(10) })] },
      NOW,
    );
    expect(r.rejected).toEqual([
      { kind: "car_audio_route", reason: "future_timestamp" },
    ]);
  });

  it("tolerates small clock skew rather than calling it a lie", () => {
    const r = parseSignalReport(
      { observations: [wire({ lastSeenAtMs: NOW + 30_000 })] },
      NOW,
    );
    expect(r.rejected).toEqual([]);
    expect(r.observations).toHaveLength(1);
  });

  it("rejects an interval that ends before it starts", () => {
    const r = parseSignalReport(
      {
        observations: [
          wire({ startedAtMs: NOW - m(2), endedAtMs: NOW - m(20) }),
        ],
      },
      NOW,
    );
    expect(r.rejected).toEqual([
      { kind: "car_audio_route", reason: "malformed" },
    ]);
  });

  it("caps how many observations one payload may contribute", () => {
    // A native producer looping on a broadcast must not be able to fill
    // the column.
    const many = Array.from({ length: MAX_OBSERVATIONS_PER_REPORT + 5 }, () =>
      wire(),
    );
    const r = parseSignalReport({ observations: many }, NOW);
    expect(r.observations).toHaveLength(MAX_OBSERVATIONS_PER_REPORT);
    expect(r.rejected).toEqual([
      { kind: null, reason: "too_many_observations" },
    ]);
  });

  it("clamps strength into 0..1 instead of trusting the device", () => {
    const r = parseSignalReport(
      { observations: [wire({ strength: 4 })] },
      NOW,
    );
    expect(r.observations[0].strength).toBe(1);
  });

  it("never throws on garbage", () => {
    for (const junk of [null, undefined, 7, "x", [], { observations: 3 }]) {
      const r = parseSignalReport(junk, NOW);
      expect(r.observations).toEqual([]);
    }
  });

  it("round-trips what the adapter produces without losing a field", () => {
    // The adapter and this parser are two ends of one wire. Anything the
    // adapter sets and this drops is information that dies in transit,
    // which is how instrumentation ends up reporting a healthy blank.
    const produced: SignalObservation = {
      kind: "motion_activity_automotive",
      platform: "ios",
      startedAtMs: NOW - m(9),
      lastSeenAtMs: NOW - m(1),
      endedAtMs: null,
      source: "live",
      strength: 0.6,
      detail: null,
    };
    const r = parseSignalReport(
      { observations: [JSON.parse(JSON.stringify(produced))] },
      NOW,
    );
    expect(r.observations[0]).toEqual(produced);
  });
});
