import { describe, expect, it } from "vitest";
import {
  FLUSH_AT_POINTS,
  FLUSH_EVERY_MS,
  shouldFlush,
} from "./flush-policy";

/**
 * MEASURED 2026-08-09, the driver's Galaxy Fold, eleven upload stalls in
 * one day, the longest 152 minutes.
 *
 * native-tracker.ts has three flush triggers:
 *
 *   location callback   only when buffer.length >= FLUSH_AT_POINTS
 *   setInterval         every FLUSH_EVERY_MS
 *   startup             drains a killed-mid-drive leftover
 *
 * A backgrounded WebView freezes timers while still delivering native
 * location callbacks (see lib/mileage/heartbeat-timer.ts for the twelve
 * hour measurement that established this). So in the background the
 * interval never fires and the ONLY trigger left is the 40 point
 * threshold.
 *
 * Parked, points arrive about every 70 seconds. 40 points is therefore
 * 47 minutes of silence, and the batch that finally landed at 23:54 held
 * exactly 40 points after exactly a 47 minute gap. The arithmetic is not
 * a coincidence, it is the bug.
 *
 * The constant's own comment already says "flush when either threshold
 * trips", and FLUSH_EVERY_MS was cut from 2 minutes to 30 seconds
 * specifically so a drive's points reach the server WHILE the drive is
 * happening. That promise has been false whenever the app is
 * backgrounded, which is most of the time a drive happens.
 *
 * So the elapsed test moves off the timer and onto the caller, evaluated
 * on wall clock from the location callback, exactly as the heartbeat fix
 * did.
 */

describe("shouldFlush", () => {
  it("never flushes an empty buffer, however long it has been", () => {
    // The flush function has its own sessionEnded override for closing a
    // trip with no points. This policy is only about pending points.
    expect(
      shouldFlush({ bufferLength: 0, msSinceLastFlush: 60 * 60_000 }),
    ).toBe(false);
  });

  it("flushes on the point threshold, which is the only trigger that worked", () => {
    expect(
      shouldFlush({ bufferLength: FLUSH_AT_POINTS, msSinceLastFlush: 0 }),
    ).toBe(true);
  });

  it("does not flush a small buffer that was just sent", () => {
    expect(shouldFlush({ bufferLength: 3, msSinceLastFlush: 1_000 })).toBe(
      false,
    );
  });

  it("flushes a single point once the interval has elapsed", () => {
    // THE FIX. One point and 30 seconds is a flush, where before it took
    // 40 points because the interval could not fire.
    expect(
      shouldFlush({ bufferLength: 1, msSinceLastFlush: FLUSH_EVERY_MS }),
    ).toBe(true);
  });

  it("ends the 47 minute parked stall", () => {
    // Parked: one point every ~70s. Under the old rule the buffer had to
    // reach 40, which is 47 minutes. Under the new rule the second point
    // already clears the interval.
    const parkedCadenceMs = 70_000;
    expect(
      shouldFlush({ bufferLength: 2, msSinceLastFlush: parkedCadenceMs }),
    ).toBe(true);
  });

  it("uploads mid-drive rather than after it", () => {
    // Driving: a point every ~5s. 40 points is 200s, so a 3 minute drive
    // used to finish before anything was staged. Six points is 30s.
    const drivingCadenceMs = 5_000;
    expect(
      shouldFlush({
        bufferLength: 6,
        msSinceLastFlush: 6 * drivingCadenceMs,
      }),
    ).toBe(true);
  });

  it("keeps the interval well under the finalize dwell that ends a trip", () => {
    // finalize closes an open trip after TRIP_END_DWELL_MS (10 min) of
    // no points, judged on what the SERVER has. If the flush interval
    // ever approached that, an upload gap would start looking like a
    // parked car again, which is the failure #549 fixed from the other
    // side.
    expect(FLUSH_EVERY_MS).toBeLessThan(10 * 60_000 / 4);
  });

  it("treats a clock that jumped backwards as not yet due", () => {
    // Wall clock can move. A negative elapsed must not be read as
    // "overdue" and must not spam the endpoint; the point threshold
    // still covers the buffer growing.
    expect(shouldFlush({ bufferLength: 5, msSinceLastFlush: -60_000 })).toBe(
      false,
    );
  });
});
