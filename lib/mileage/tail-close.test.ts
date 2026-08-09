import { describe, expect, it } from "vitest";
import { TRIP_END_DWELL_MS } from "./segmentation";
import { TAIL_CLOSE_CEILING_MS, shouldCloseOpenTail } from "./tail-close";

/**
 * MEASURED 2026-08-09, the driver's Galaxy Fold, one day of driving.
 *
 * The old rule was:
 *
 *     closeOpenAtEnd = forceClose || lastPointAgeMs >= TRIP_END_DWELL_MS
 *
 * `lastPointAgeMs` is measured against the newest point THE SERVER HAS.
 * That is upload recency, not driving. A phone whose WebView cannot flush
 * looks exactly like a parked car.
 *
 * Eleven upload stalls that day, 11 to 152 minutes each, while GPS capture
 * ran continuously the whole time. Every trip boundary landed on a stall
 * boundary:
 *
 *     trip ended 15:23:00   uploads stopped 15:23:01
 *     trip ended 17:43:12   uploads stopped 17:43:12
 *     trip ended 20:03:41   uploads stopped 20:03:41
 *
 * Three for three. finalize closed each drive at the last uploaded point,
 * the backlog landed up to 42 minutes later, and the remainder became a
 * second trip starting SIX SECONDS after the first ended.
 *
 * The rule now needs positive evidence the device is IDLE rather than
 * merely SILENT. A heartbeat that arrived after the last point proves the
 * phone was alive and simply not producing GPS, which is a parked car. A
 * silent phone is unknowable, so the trip stays open and the backlog
 * completes it as one drive.
 */

const NOW = 1_760_000_000_000;
const MIN = 60_000;

describe("tail-close needs the device to be idle, not just silent", () => {
  it("closes on an explicit end regardless of anything else", () => {
    // sessionEnded / walked-away is evidence, not a guess.
    expect(
      shouldCloseOpenTail({
        forceClose: true,
        lastPointTs: NOW - 1000,
        deviceReportedAtMs: null,
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("never closes while points are still fresh", () => {
    expect(
      shouldCloseOpenTail({
        forceClose: false,
        lastPointTs: NOW - 2 * MIN,
        deviceReportedAtMs: NOW - MIN,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("closes when a heartbeat arrived after the last point plus the dwell", () => {
    // The phone was alive and reporting, and produced no GPS for the whole
    // dwell. That is a parked car, which is the case the old rule was
    // written for and the only case it was ever right about.
    const lastPointTs = NOW - 30 * MIN;
    expect(
      shouldCloseOpenTail({
        forceClose: false,
        lastPointTs,
        deviceReportedAtMs: lastPointTs + TRIP_END_DWELL_MS + MIN,
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("does NOT close when the device went silent with the points", () => {
    // THE REGRESSION TEST. 15:23 exactly: last point 15:23:00, uploads
    // dead until 16:05, no heartbeat in between (heartbeats ride the same
    // fetch path, so a stall silences them too). Parked and stalled are
    // indistinguishable here, so the honest answer is "do not close".
    const lastPointTs = NOW - 42 * MIN;
    expect(
      shouldCloseOpenTail({
        forceClose: false,
        lastPointTs,
        deviceReportedAtMs: lastPointTs - MIN, // last beat BEFORE the stall
        nowMs: NOW,
      }),
      "closing here is what severed three drives on 2026-08-09",
    ).toBe(false);
  });

  it("treats a device that never reported as silent", () => {
    expect(
      shouldCloseOpenTail({
        forceClose: false,
        lastPointTs: NOW - 42 * MIN,
        deviceReportedAtMs: null,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it("closes anyway past the hard ceiling, so nothing stays open forever", () => {
    // A phone that is switched off, reinstalled, or out of coverage for a
    // day must not leave a trip open indefinitely, or the drive never
    // materialises and never becomes deductible.
    expect(
      shouldCloseOpenTail({
        forceClose: false,
        lastPointTs: NOW - TAIL_CLOSE_CEILING_MS - MIN,
        deviceReportedAtMs: null,
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it("keeps the ceiling well clear of the worst observed stall", () => {
    // Longest stall measured that day was 152 minutes. The ceiling has to
    // sit far enough above it that a bad-signal afternoon cannot reach it,
    // or this fix quietly reintroduces the bug it exists to prevent.
    const worstObservedStallMs = 152 * MIN;
    expect(TAIL_CLOSE_CEILING_MS).toBeGreaterThan(worstObservedStallMs * 2);
  });
});
