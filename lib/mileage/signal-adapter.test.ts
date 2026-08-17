import { describe, expect, it } from "vitest";
import {
  CLOCK_DRIFT_TOLERANCE_MS,
  POLL_ONLY_STRENGTH,
  foldVehicleSignalEvents,
  type NativeVehicleSignalEvent,
} from "./signal-adapter";

const BOOT = 1_799_000_000_000;
const NOW = 1_800_000_000_000;
const m = (n: number) => n * 60_000;

function ev(
  over: Partial<NativeVehicleSignalEvent> & { tsMs: number },
): NativeVehicleSignalEvent {
  return {
    kind: "carAudioRoute",
    state: "connected",
    monotonicMs: over.tsMs - BOOT,
    bootMs: BOOT,
    source: "event",
    confidence: null,
    ...over,
  };
}

const opts = { platform: "ios" as const, nowMs: NOW, bootMs: BOOT };

describe("car audio route", () => {
  it("folds a connect and a disconnect into one closed interval", () => {
    const r = foldVehicleSignalEvents(
      [
        ev({ tsMs: NOW - m(30), state: "connected" }),
        ev({ tsMs: NOW - m(5), state: "disconnected" }),
      ],
      opts,
    );
    expect(r.observations).toHaveLength(1);
    expect(r.observations[0]).toMatchObject({
      kind: "car_audio_route",
      platform: "ios",
      startedAtMs: NOW - m(30),
      endedAtMs: NOW - m(5),
      source: "event",
    });
  });

  it("leaves a connection that never dropped open", () => {
    const r = foldVehicleSignalEvents(
      [ev({ tsMs: NOW - m(8), state: "connected" })],
      opts,
    );
    expect(r.observations[0].endedAtMs).toBeNull();
  });

  it("lets a poll refresh a connection an event opened, without reopening it", () => {
    const r = foldVehicleSignalEvents(
      [
        ev({ tsMs: NOW - m(30), state: "connected", source: "event" }),
        ev({ tsMs: NOW - m(2), state: "connected", source: "poll" }),
      ],
      opts,
    );
    expect(r.observations).toHaveLength(1);
    expect(r.observations[0]).toMatchObject({
      startedAtMs: NOW - m(30),
      lastSeenAtMs: NOW - m(2),
      endedAtMs: null,
    });
    expect(r.observations[0].strength).toBeUndefined();
  });

  it("discounts a connection only ever seen by a poll", () => {
    // A poll says "connected when we looked". It cannot tell a car that
    // just started from one parked with the accessories on all evening,
    // so it must not carry the weight of a real transition.
    const r = foldVehicleSignalEvents(
      [ev({ tsMs: NOW - m(1), state: "connected", source: "poll" })],
      opts,
    );
    expect(r.observations[0].strength).toBe(POLL_ONLY_STRENGTH);
    expect(r.observations[0].source).toBe("poll");
  });

  it("rejects a car audio route claimed by an Android device", () => {
    const r = foldVehicleSignalEvents([ev({ tsMs: NOW })], {
      ...opts,
      platform: "android",
    });
    expect(r.observations).toEqual([]);
    expect(r.rejected).toEqual([
      { kind: "car_audio_route", reason: "unsupported_on_platform" },
    ]);
  });
});

describe("motion", () => {
  it("carries CoreMotion's confidence through as evidence strength", () => {
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: NOW - m(3),
          kind: "motionActivity",
          state: "automotive",
          source: "live",
          confidence: 0.9,
        }),
      ],
      opts,
    );
    expect(r.observations[0]).toMatchObject({
      kind: "motion_activity_automotive",
      strength: 0.9,
    });
  });

  it("does not break a drive at a red light", () => {
    // stationary and automotive are non-exclusive in CoreMotion. Stopped
    // at a light reads as both, and treating that as "not driving" would
    // chop every drive at every junction.
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: NOW - m(10),
          kind: "motionActivity",
          state: "automotive",
          source: "live",
          confidence: 0.9,
        }),
        ev({
          tsMs: NOW - m(6),
          kind: "motionActivity",
          state: "stationary",
          source: "live",
          confidence: 0.9,
        }),
        ev({
          tsMs: NOW - m(2),
          kind: "motionActivity",
          state: "automotive",
          source: "live",
          confidence: 0.9,
        }),
      ],
      opts,
    );
    expect(r.observations).toHaveLength(1);
    expect(r.observations[0]).toMatchObject({
      startedAtMs: NOW - m(10),
      lastSeenAtMs: NOW - m(2),
      endedAtMs: null,
    });
    expect(r.rejected).toEqual([]);
  });

  it("folds a recovered history segment into a retrospective observation", () => {
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: NOW - m(200),
          kind: "motionHistory",
          state: "automotive",
          source: "history",
          confidence: 0.6,
        }),
      ],
      opts,
    );
    expect(r.observations[0]).toMatchObject({
      kind: "motion_history_automotive",
      source: "history",
      strength: 0.6,
    });
  });
});

describe("capture audits become gaps, never drives", () => {
  it("reports duration only, with no distance anywhere in the shape", () => {
    // Motion history contains NO location. It can prove a drive happened
    // and never where it went, so a gap is surfaced and never filled. A
    // fabricated mile is worse than a missed one.
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: NOW - m(5),
          kind: "captureAudit",
          state: "drivingMissed",
          source: "audit",
          detail: {
            fromTsMs: NOW - m(60),
            toTsMs: NOW - m(5),
            gapMs: m(55),
            automotiveMs: m(34),
          },
        }),
      ],
      opts,
    );
    expect(r.gaps).toEqual([
      {
        fromMs: NOW - m(60),
        toMs: NOW - m(5),
        gapMs: m(55),
        automotiveMs: m(34),
      },
    ]);
    expect(Object.keys(r.gaps[0])).not.toContain("distanceM");
    // And it contributed no observation of its own.
    expect(r.observations).toEqual([]);
  });

  it("raises no gap when the OS says nothing was missed", () => {
    // A window the OS reports as containing no driving is a REASSURING
    // result, not an alarm. Recording it as a gap would manufacture an
    // incident out of a quiet afternoon.
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: NOW - m(5),
          kind: "captureAudit",
          state: "noDrivingInGap",
          source: "audit",
          detail: { gapMs: m(55), automotiveMs: 0 },
        }),
      ],
      opts,
    );
    expect(r.gaps).toEqual([]);
  });

  it("raises no gap when the audit could not run", () => {
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: NOW - m(5),
          kind: "captureAudit",
          state: "denied",
          source: "audit",
          detail: { gapMs: m(55), automotiveMs: 0 },
        }),
      ],
      opts,
    );
    expect(r.gaps).toEqual([]);
    expect(r.rejected).toEqual([]);
  });
});

describe("clocks", () => {
  it("rewrites a wall clock that disagrees with the monotonic clock", () => {
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: NOW - m(600),
          monotonicMs: NOW - m(10) - BOOT,
          state: "connected",
        }),
      ],
      opts,
    );
    expect(r.clockCorrections).toBe(1);
    expect(r.observations[0].startedAtMs).toBe(NOW - m(10));
  });

  it("leaves an event from an earlier boot alone", () => {
    // A different boot epoch means the two monotonic clocks share no
    // origin. Differencing across it would fabricate hours of age.
    const older = BOOT - m(5000);
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: NOW - m(20),
          monotonicMs: 1_000,
          bootMs: older,
          state: "connected",
        }),
      ],
      opts,
    );
    expect(r.clockCorrections).toBe(0);
    expect(r.observations[0].startedAtMs).toBe(NOW - m(20));
  });

  it("tolerates drift below the threshold without rewriting", () => {
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: NOW - m(20),
          monotonicMs: NOW - m(20) - BOOT + CLOCK_DRIFT_TOLERANCE_MS / 2,
          state: "connected",
        }),
      ],
      opts,
    );
    expect(r.clockCorrections).toBe(0);
    expect(r.observations[0].startedAtMs).toBe(NOW - m(20));
  });

  it("rejects an event from the future", () => {
    const r = foldVehicleSignalEvents(
      [ev({ tsMs: NOW + m(30), monotonicMs: NOW + m(30) - BOOT })],
      opts,
    );
    expect(r.observations).toEqual([]);
    expect(r.rejected).toEqual([
      { kind: "car_audio_route", reason: "future_timestamp" },
    ]);
  });

  it("orders by corrected time, not arrival order", () => {
    const r = foldVehicleSignalEvents(
      [
        ev({ tsMs: NOW - m(2), state: "disconnected" }),
        ev({ tsMs: NOW - m(30), state: "connected" }),
      ],
      opts,
    );
    expect(r.observations).toHaveLength(1);
    expect(r.observations[0]).toMatchObject({
      startedAtMs: NOW - m(30),
      endedAtMs: NOW - m(2),
    });
  });
});

describe("garbage in", () => {
  it("records an unknown kind rather than dropping it silently", () => {
    const r = foldVehicleSignalEvents(
      [ev({ tsMs: NOW, kind: "telepathy" as never })],
      opts,
    );
    expect(r.rejected).toEqual([{ kind: null, reason: "unknown_kind" }]);
  });

  it("records a malformed entry", () => {
    const r = foldVehicleSignalEvents(
      [null as unknown as NativeVehicleSignalEvent],
      opts,
    );
    expect(r.rejected).toEqual([{ kind: null, reason: "malformed" }]);
  });

  it("returns an empty, honest result for no events at all", () => {
    const r = foldVehicleSignalEvents([], opts);
    expect(r).toEqual({
      observations: [],
      gaps: [],
      rejected: [],
      clockCorrections: 0,
    });
  });
});
