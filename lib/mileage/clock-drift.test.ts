import { describe, expect, it } from "vitest";

/**
 * The arithmetic behind TaxotticGeofenceStore.correctTime, pinned here
 * because the Java has no unit-test harness in this repo and the rule is
 * too easy to get backwards.
 *
 * WHAT WENT WRONG, measured 2026-08-12.
 *
 * One Home-to-Zinpro commute was recorded TWICE. The copies were
 * identical in space, 166 of 166 points within 9 m of the other path,
 * and offset by a constant 19.3 minutes in time. It double-counted
 * 11.98 miles, and no existing guard could catch it: the
 * plausible-jump gate looks for impossible movement WITHIN a stream,
 * and each copy is a faithful recording of a real drive. Nothing inside
 * either one is implausible. Only holding them side by side reveals it.
 *
 * The cause is that Android's location.getTime() is a wall-clock value
 * reconstructed from a boot anchor. Move the anchor and every fix in the
 * batch shifts by the SAME amount, staying perfectly self-consistent
 * while pointing at the wrong minute.
 *
 * elapsedRealtimeNanos counts from boot and ignores clock changes, so
 * the age of a fix measured against it is always true:
 *
 *     trueTime = now - (elapsedNow - elapsedAtFix)
 */

const MS = 1_000_000; // nanoseconds per millisecond

/** Mirrors correctTime(). Returns the corrected wall time in ms. */
function correctTime(args: {
  storedTime: number;
  elapsedAtFixNanos: number;
  nowMs: number;
  elapsedNowNanos: number;
}): { time: number; driftMs: number | null } {
  const { storedTime, elapsedAtFixNanos, nowMs, elapsedNowNanos } = args;
  if (elapsedAtFixNanos <= 0) return { time: storedTime, driftMs: null };
  const agoMs = Math.floor((elapsedNowNanos - elapsedAtFixNanos) / MS);
  if (agoMs < 0) return { time: storedTime, driftMs: null };
  const derived = nowMs - agoMs;
  return { time: derived, driftMs: storedTime > 0 ? derived - storedTime : null };
}

const NOW = Date.parse("2026-08-12T15:37:55Z");
const ELAPSED_NOW = 9_000_000 * MS; // 2.5 h since boot

describe("a fix with a correct clock is left where it is", () => {
  it("returns the same instant it was recorded", () => {
    const fiveMinAgo = 5 * 60_000;
    const out = correctTime({
      storedTime: NOW - fiveMinAgo,
      elapsedAtFixNanos: ELAPSED_NOW - fiveMinAgo * MS,
      nowMs: NOW,
      elapsedNowNanos: ELAPSED_NOW,
    });
    expect(out.time).toBe(NOW - fiveMinAgo);
    expect(out.driftMs).toBe(0);
  });
});

describe("the production incident", () => {
  it("pulls a batch shifted 19.3 minutes back to where it happened", () => {
    // The real drive ran 15:13:51 to 15:37:55. The phantom copy claimed
    // 14:54:32 to 15:12:25, a constant 19.3 min early.
    const driftMs = Math.round(19.3 * 60_000);
    const realInstant = Date.parse("2026-08-12T15:20:36Z");
    const ageMs = NOW - realInstant;

    const out = correctTime({
      // What the platform wrongly believed.
      storedTime: realInstant - driftMs,
      // The monotonic clock, which was never wrong.
      elapsedAtFixNanos: ELAPSED_NOW - ageMs * MS,
      nowMs: NOW,
      elapsedNowNanos: ELAPSED_NOW,
    });

    expect(out.time).toBe(realInstant);
    expect(out.driftMs).toBe(driftMs);
  });

  it("collapses the whole batch onto the real times, not just one point", () => {
    // The bug's signature is a CONSTANT offset, so the correction has to
    // hold across the batch or it just trades one wrong shape for another.
    const driftMs = Math.round(19.3 * 60_000);
    for (const minsAgo of [0, 4, 8, 12, 17, 24]) {
      const real = NOW - minsAgo * 60_000;
      const out = correctTime({
        storedTime: real - driftMs,
        elapsedAtFixNanos: ELAPSED_NOW - minsAgo * 60_000 * MS,
        nowMs: NOW,
        elapsedNowNanos: ELAPSED_NOW,
      });
      expect(out.time).toBe(real);
    }
  });

  it("makes the duplicate dedupe itself", () => {
    // The ingest upsert identity is (driver_user_id, captured_at). Once
    // both copies carry the SAME corrected timestamp, the second write
    // is a no-op and the duplicate trip cannot form. That is the whole
    // point: the existing dedupe was already correct and simply never
    // got a chance to fire.
    const real = Date.parse("2026-08-12T15:20:36Z");
    const ageMs = NOW - real;
    const live = correctTime({
      storedTime: real,
      elapsedAtFixNanos: ELAPSED_NOW - ageMs * MS,
      nowMs: NOW,
      elapsedNowNanos: ELAPSED_NOW,
    });
    const replayed = correctTime({
      storedTime: real - 19.3 * 60_000,
      elapsedAtFixNanos: ELAPSED_NOW - ageMs * MS,
      nowMs: NOW,
      elapsedNowNanos: ELAPSED_NOW,
    });
    expect(replayed.time).toBe(live.time);
  });
});

describe("refusing to correct when it cannot", () => {
  it("keeps the stored time for fixes from older builds", () => {
    // No elapsedNanos was recorded, so there is nothing to measure
    // against. Those fixes must behave exactly as they did before.
    const out = correctTime({
      storedTime: 1_760_000_000_000,
      elapsedAtFixNanos: 0,
      nowMs: NOW,
      elapsedNowNanos: ELAPSED_NOW,
    });
    expect(out.time).toBe(1_760_000_000_000);
    expect(out.driftMs).toBeNull();
  });

  it("keeps the stored time across a reboot", () => {
    // elapsedRealtime restarts at zero on boot, so a value larger than
    // the current elapsed clock belongs to a previous epoch and is
    // meaningless. Correcting on it would invent a time.
    const out = correctTime({
      storedTime: 1_760_000_000_000,
      elapsedAtFixNanos: ELAPSED_NOW + 60_000 * MS,
      nowMs: NOW,
      elapsedNowNanos: ELAPSED_NOW,
    });
    expect(out.time).toBe(1_760_000_000_000);
  });

  it("never returns a time in the future", () => {
    const out = correctTime({
      storedTime: NOW + 3_600_000,
      elapsedAtFixNanos: ELAPSED_NOW - 60_000 * MS,
      nowMs: NOW,
      elapsedNowNanos: ELAPSED_NOW,
    });
    expect(out.time).toBeLessThanOrEqual(NOW);
  });
});
