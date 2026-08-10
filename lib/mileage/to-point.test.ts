import { describe, expect, it } from "vitest";
import { toPoint } from "./to-point";

/**
 * A location with no usable timestamp is DROPPED, never dated to now.
 *
 * The old line was:
 *
 *   ts: typeof p.time === "number" && p.time > 0 ? p.time : Date.now(),
 *
 * so a fix arriving without a time was stamped with the moment it was
 * PROCESSED and stored as the moment it was CAPTURED. That is not a
 * rounding error, it is a fabricated fact in a tax record.
 *
 * The damage is worst exactly where the fallback is most likely to fire.
 * A buffered batch drained after a blackout would have every point
 * collapsed onto the same instant, which puts a whole drive at the wrong
 * time, in the wrong trip, potentially in the wrong tax year, and (once
 * the ingest gate landed) reads as a teleport cluster that gets refused
 * anyway.
 *
 * Dropping loses a position. Dating it to now invents one. For mileage
 * that a driver deducts, losing a point is recoverable and inventing one
 * is not, so the ambiguity resolves to null. toPoint already returns
 * `GpsPoint | null` and already drops non-finite coordinates, so every
 * caller handles this.
 */

const VALID = {
  latitude: 44.7619,
  longitude: -93.4731,
  accuracy: 5,
  speed: 12.5,
  time: 1_760_000_000_000,
};

describe("toPoint", () => {
  it("maps a good fix straight through", () => {
    expect(toPoint(VALID)).toEqual({
      lat: 44.7619,
      lng: -93.4731,
      ts: 1_760_000_000_000,
      speedMps: 12.5,
      accuracyM: 5,
    });
  });

  it("drops a fix with no timestamp instead of dating it to now", () => {
    expect(toPoint({ ...VALID, time: null })).toBeNull();
  });

  it("drops a zero timestamp, the epoch is not a capture time", () => {
    expect(toPoint({ ...VALID, time: 0 })).toBeNull();
  });

  it("drops a negative or non-finite timestamp", () => {
    expect(toPoint({ ...VALID, time: -1 })).toBeNull();
    expect(toPoint({ ...VALID, time: NaN })).toBeNull();
    expect(toPoint({ ...VALID, time: Infinity })).toBeNull();
  });

  it("never returns a timestamp near the current moment for a timeless fix", () => {
    // The regression stated directly: if this ever returns a point, its
    // ts must not be "now", because that is the fabrication.
    const before = Date.now();
    const out = toPoint({ ...VALID, time: null });
    const after = Date.now();
    if (out !== null) {
      expect(out.ts < before || out.ts > after).toBe(true);
    }
    expect(out).toBeNull();
  });

  it("still drops non-finite coordinates", () => {
    expect(toPoint({ ...VALID, latitude: NaN })).toBeNull();
    expect(toPoint({ ...VALID, longitude: Infinity })).toBeNull();
  });

  it("omits speed and accuracy when the platform did not supply them", () => {
    const out = toPoint({ ...VALID, speed: null, accuracy: -1 });
    expect(out).not.toBeNull();
    expect(out!.speedMps).toBeUndefined();
    expect(out!.accuracyM).toBeUndefined();
    // Position and time are what make a point usable; the rest is detail.
    expect(out!.ts).toBe(VALID.time);
  });

  it("keeps a zero speed, which is a real reading and not a missing one", () => {
    expect(toPoint({ ...VALID, speed: 0 })!.speedMps).toBe(0);
  });
});
