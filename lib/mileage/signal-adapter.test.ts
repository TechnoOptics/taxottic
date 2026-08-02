import { describe, expect, it } from "vitest";
import {
  POLL_ONLY_STRENGTH,
  foldVehicleSignalEvents,
  type NativeVehicleSignalEvent,
} from "./signal-adapter";
import { START_THRESHOLD, scoreDrive } from "./confidence";

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

describe("foldVehicleSignalEvents: car audio route", () => {
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
    // just started from one that has been parked with the accessories on
    // all evening, so it must not carry the weight of a real transition.
    const r = foldVehicleSignalEvents(
      [ev({ tsMs: NOW - m(1), state: "connected", source: "poll" })],
      opts,
    );
    expect(r.observations[0].strength).toBe(POLL_ONLY_STRENGTH);
    expect(r.observations[0].source).toBe("poll");
  });

  it("keeps a poll-only car connection below the trip-start bar on its own", () => {
    // The consequence that matters: a stale connection cannot masquerade
    // as a fresh trip start. It needs corroboration.
    const r = foldVehicleSignalEvents(
      [ev({ tsMs: NOW, state: "connected", source: "poll" })],
      opts,
    );
    const score = scoreDrive({
      observations: r.observations,
      availability: {},
      referenceMs: NOW,
      phase: "live",
    });
    expect(score.score).toBeLessThan(START_THRESHOLD);
  });

  it("keeps an event-backed car connection above the trip-start bar", () => {
    const r = foldVehicleSignalEvents(
      [ev({ tsMs: NOW, state: "connected", source: "event" })],
      opts,
    );
    const score = scoreDrive({
      observations: r.observations,
      availability: {},
      referenceMs: NOW,
      phase: "live",
    });
    expect(score.score).toBeGreaterThanOrEqual(START_THRESHOLD);
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

describe("foldVehicleSignalEvents: motion", () => {
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
    const automotive = r.observations.filter(
      (o) => o.kind === "motion_activity_automotive",
    );
    expect(automotive).toHaveLength(1);
    expect(automotive[0].startedAtMs).toBe(NOW - m(10));
    expect(automotive[0].lastSeenAtMs).toBe(NOW - m(2));
  });

  it("never turns a stationary reading into counter-evidence", () => {
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: NOW,
          kind: "motionActivity",
          state: "stationary",
          source: "live",
          confidence: 0.9,
        }),
      ],
      opts,
    );
    expect(r.observations).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it("folds recovered history into a retrospective-only observation", () => {
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: NOW - m(90),
          kind: "motionHistory",
          state: "automotive",
          source: "history",
          confidence: 0.6,
        }),
      ],
      opts,
    );
    expect(r.observations[0].kind).toBe("motion_history_automotive");
    const live = scoreDrive({
      observations: r.observations,
      availability: {},
      referenceMs: NOW,
      phase: "live",
    });
    expect(live.score).toBe(0);
  });
});

describe("foldVehicleSignalEvents: capture audit", () => {
  it("reports a missed drive as a gap, never as a drive", () => {
    // There is no location in motion history, so it can prove a drive
    // happened and never where it went. A deductible mile cannot come
    // from here.
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: NOW - m(10),
          kind: "captureAudit",
          state: "drivingMissed",
          source: "audit",
          confidence: null,
          detail: {
            fromTsMs: NOW - m(120),
            toTsMs: NOW - m(10),
            gapMs: m(110),
            automotiveMs: m(24),
          },
        }),
      ],
      opts,
    );
    expect(r.observations).toEqual([]);
    expect(r.gaps).toEqual([
      {
        fromMs: NOW - m(120),
        toMs: NOW - m(10),
        gapMs: m(110),
        automotiveMs: m(24),
      },
    ]);
  });

  it("does not report a gap when the device was simply off", () => {
    // "unknown" is documented as the device being off, so nothing was
    // missed. Raising that as a failure would cry wolf every night.
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: NOW - m(10),
          kind: "captureAudit",
          state: "unknown",
          source: "audit",
          confidence: null,
          detail: { gapMs: m(400), automotiveMs: 0 },
        }),
      ],
      opts,
    );
    expect(r.gaps).toEqual([]);
  });
});

describe("foldVehicleSignalEvents: clock integrity", () => {
  it("prefers the monotonic clock when the wall clock has moved", () => {
    // monotonicMs survives a clock change; tsMs does not. An hour of
    // fabricated age would silently decay real evidence to nothing.
    const trueTs = NOW - m(4);
    const r = foldVehicleSignalEvents(
      [
        ev({
          tsMs: trueTs - m(60),
          monotonicMs: trueTs - BOOT,
          state: "connected",
        }),
      ],
      opts,
    );
    expect(r.observations[0].startedAtMs).toBe(trueTs);
    expect(r.clockCorrections).toBe(1);
  });

  it("leaves an event from an earlier boot alone", () => {
    const r = foldVehicleSignalEvents(
      [ev({ tsMs: NOW - m(5), bootMs: BOOT - m(5000), monotonicMs: 1000 })],
      opts,
    );
    expect(r.observations[0].startedAtMs).toBe(NOW - m(5));
    expect(r.clockCorrections).toBe(0);
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

  it("records an unrecognised event kind rather than dropping it", () => {
    const r = foldVehicleSignalEvents(
      [ev({ tsMs: NOW, kind: "telepathy" as NativeVehicleSignalEvent["kind"] })],
      opts,
    );
    expect(r.rejected).toEqual([{ kind: null, reason: "unknown_kind" }]);
  });

  it("returns an empty fold for an empty drain", () => {
    expect(foldVehicleSignalEvents([], opts)).toEqual({
      observations: [],
      gaps: [],
      rejected: [],
      clockCorrections: 0,
    });
  });
});
