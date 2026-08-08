import { describe, expect, it } from "vitest";
import {
  ARM_IN_FLIGHT_GRACE_MS,
  ARM_LATCH_MAX_AGE_MS,
  isArmInterrupted,
  parseArmLatch,
} from "./arm-latch";

const NOW = Date.parse("2026-08-08T14:00:00Z");

describe("isArmInterrupted", () => {
  it("reports nothing when no arm was ever in flight", () => {
    expect(isArmInterrupted(null, NOW)).toBe(false);
  });

  it("does not flag an arm that is still in flight", () => {
    // The real stop-then-start completes in milliseconds. A latch set one
    // second ago is a concurrent tick, not a casualty.
    expect(isArmInterrupted(NOW - 1_000, NOW)).toBe(false);
  });

  it("flags an arm that never completed", () => {
    // The failure this exists for: stop() ran, the context died at the
    // await, start() never did, and the background service is down.
    expect(isArmInterrupted(NOW - 5 * 60_000, NOW)).toBe(true);
  });

  it("treats the grace boundary as still in flight", () => {
    expect(isArmInterrupted(NOW - ARM_IN_FLIGHT_GRACE_MS, NOW)).toBe(false);
  });

  it("flags one millisecond past the grace boundary", () => {
    expect(isArmInterrupted(NOW - ARM_IN_FLIGHT_GRACE_MS - 1, NOW)).toBe(true);
  });

  it("ignores an ancient latch rather than alarming forever", () => {
    expect(isArmInterrupted(NOW - ARM_LATCH_MAX_AGE_MS - 1, NOW)).toBe(false);
  });

  it("ignores a latch from the future (clock change, not evidence)", () => {
    expect(isArmInterrupted(NOW + 60_000, NOW)).toBe(false);
  });
});

describe("parseArmLatch", () => {
  it("reads a normal timestamp", () => {
    expect(parseArmLatch(String(NOW))).toBe(NOW);
  });

  it.each([null, "", "not-a-number", "0", "-1", "NaN"])(
    "treats %o as absent rather than as an incident",
    (raw) => {
      expect(parseArmLatch(raw as string | null)).toBe(null);
    },
  );
});
