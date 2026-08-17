import { describe, expect, it } from "vitest";
import {
  clusterByCaptureGap,
  diagnoseCluster,
  shouldForceCloseRecovery,
  summariseRecovery,
  RECOVERY_WINDOW_DAYS,
} from "./recovery";
import { MAX_PLAUSIBLE_MPS } from "./plausible-jump";
import { TRIP_END_DWELL_MS } from "./segmentation";

/**
 * These tests encode the measured 2026-08-17 incident, so they are
 * written against real shapes rather than invented ones:
 *
 *   - 3,556 points of one 19.56 mi drive delivered THREE times (a live
 *     whole-second stream plus two replayed copies offset .297 and .928),
 *     interleaved in captured_at order so consecutive rows alternate
 *     between points 4.6 km apart. 1,263 of 3,351 transitions implied
 *     over 60 m/s, the worst 88,783 m/s.
 *   - ~18,300 points of genuinely stationary residue spread over 41 days,
 *     which never displaces far enough to become a trip and is therefore
 *     not a lost drive at all.
 *
 * The distinction is the whole point of the control: one of those is a
 * drive the driver is owed and the other is parked-phone noise, and a
 * recovery button that reports them as one number is lying.
 */

const T0 = Date.parse("2026-08-17T01:45:00.000Z");
const BASE_LAT = 44.9654;
const BASE_LNG = -93.3491;

/** ~111 m per 0.001 deg of latitude, which is all these tests need. */
function pt(offsetSec: number, latOffset = 0, lngOffset = 0) {
  return {
    lat: BASE_LAT + latOffset,
    lng: BASE_LNG + lngOffset,
    ts: T0 + offsetSec * 1000,
  };
}

/** A steady southbound drive: ~111 m every 5 s, about 22 m/s. */
function drivingPoints(count: number, startSec = 0) {
  return Array.from({ length: count }, (_, i) =>
    pt(startSec + i * 5, -0.001 * i),
  );
}

/** A parked phone: jitter of a few metres, never 200 m from anywhere. */
function parkedPoints(count: number, startSec = 0) {
  return Array.from({ length: count }, (_, i) =>
    pt(startSec + i * 30, 0.00002 * (i % 3), 0.00002 * ((i + 1) % 3)),
  );
}

describe("clusterByCaptureGap", () => {
  it("splits the pool where capture stops for longer than the gap", () => {
    const points = [pt(0), pt(60), pt(120), pt(1200), pt(1260)];

    const clusters = clusterByCaptureGap(points, 8 * 60_000);

    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toHaveLength(3);
    expect(clusters[1]).toHaveLength(2);
  });

  it("keeps a continuous stream as one cluster", () => {
    const clusters = clusterByCaptureGap(drivingPoints(50), 8 * 60_000);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]).toHaveLength(50);
  });

  it("returns no clusters for an empty pool", () => {
    expect(clusterByCaptureGap([], 8 * 60_000)).toEqual([]);
  });
});

describe("diagnoseCluster", () => {
  const settledNow = T0 + 6 * 60 * 60_000;

  it("reports a parked phone as stationary, not as a lost drive", () => {
    const verdict = diagnoseCluster(parkedPoints(200), settledNow);

    expect(verdict.kind).toBe("stationary");
    expect(verdict.points).toBe(200);
  });

  it("reports a clean drive that never materialised as recoverable", () => {
    const verdict = diagnoseCluster(drivingPoints(100), settledNow);

    expect(verdict.kind).toBe("recoverable");
    expect(verdict.points).toBe(100);
  });

  it("reports an interleaved duplicate delivery as contaminated", () => {
    // The measured shape: a live stream that has progressed ~4.6 km south
    // interleaved with a replayed copy still sitting at the origin.
    const interleaved = [];
    for (let i = 0; i < 40; i++) {
      interleaved.push(pt(i * 2, -0.0414 - 0.0005 * i)); // live, moved on
      interleaved.push(pt(i * 2 + 1, -0.0005 * i)); // replay, at origin
    }

    const verdict = diagnoseCluster(interleaved, settledNow);

    expect(verdict.kind).toBe("contaminated");
    if (verdict.kind !== "contaminated") throw new Error("unreachable");
    expect(verdict.jumps).toBeGreaterThan(0);
    expect(verdict.worstMph).toBeGreaterThan(200);
  });

  it("prefers contaminated over stationary when a pool is both", () => {
    // A teleporting pair whose endpoints are, between them, going nowhere.
    // Contamination is the more actionable fact, so it must win.
    const points = [pt(0), pt(1, 0.1), pt(2), pt(3, 0.1)];

    expect(diagnoseCluster(points, settledNow).kind).toBe("contaminated");
  });

  it("reports a drive still in progress as recording, not as stranded", () => {
    const points = drivingPoints(100);
    const lastTs = points[points.length - 1].ts;

    // Only 37 s after the newest point, which is exactly where the
    // 2026-08-17 pool stood when the driver asked where their drive was.
    const verdict = diagnoseCluster(points, lastTs + 37_000);

    expect(verdict.kind).toBe("recording");
  });

  it("stops calling a drive recording once the dwell has elapsed", () => {
    const points = drivingPoints(100);
    const lastTs = points[points.length - 1].ts;

    const verdict = diagnoseCluster(points, lastTs + 11 * 60_000);

    expect(verdict.kind).toBe("recoverable");
  });

  it("counts every implausible transition, not just the first", () => {
    const points = [pt(0), pt(1, 0.1), pt(2), pt(3, 0.1), pt(4)];

    const verdict = diagnoseCluster(points, settledNow);

    if (verdict.kind !== "contaminated") throw new Error("expected contaminated");
    expect(verdict.jumps).toBe(4);
  });

  it("does not call a legitimate long capture gap a teleport", () => {
    // 9 miles apart but twenty minutes apart: implied speed is ordinary,
    // and the jump gate keys on speed precisely so this stays clean.
    const points = [pt(0), pt(1200, -0.13)];
    const impliedMps = (0.13 * 111_320) / 1200;
    expect(impliedMps).toBeLessThan(MAX_PLAUSIBLE_MPS);

    expect(diagnoseCluster(points, settledNow).kind).not.toBe("contaminated");
  });
});

describe("summariseRecovery", () => {
  // Far enough past every fixture below that nothing reads as still
  // recording; these cases are about settled history.
  const settledNow = T0 + 30 * 24 * 60 * 60_000;

  it("separates stranded drives from parked-phone residue", () => {
    const clusters = [
      parkedPoints(300),
      drivingPoints(80, 100_000),
      parkedPoints(200, 200_000),
    ];

    const summary = summariseRecovery(clusters, settledNow);

    expect(summary.stationaryPoints).toBe(500);
    expect(summary.recoverablePoints).toBe(80);
    expect(summary.contaminatedPoints).toBe(0);
    expect(summary.totalPoints).toBe(580);
  });

  it("surfaces contamination with the detail needed to act on it", () => {
    const teleporting = [pt(0), pt(1, 0.1), pt(2), pt(3, 0.1)];

    const summary = summariseRecovery([teleporting], settledNow);

    expect(summary.contaminatedPoints).toBe(4);
    expect(summary.worstMph).toBeGreaterThan(200);
    expect(summary.contaminatedClusters).toBe(1);
  });

  it("accounts for every point it was given", () => {
    const clusters = [
      parkedPoints(120),
      drivingPoints(60, 100_000),
      [pt(200_000), pt(200_001, 0.1)],
    ];

    const summary = summariseRecovery(clusters, settledNow);

    const accounted =
      summary.stationaryPoints +
      summary.recoverablePoints +
      summary.contaminatedPoints +
      summary.recordingPoints;
    expect(accounted).toBe(summary.totalPoints);
    expect(summary.totalPoints).toBe(182);
  });

  it("reports an empty pool as nothing to do", () => {
    const summary = summariseRecovery([], settledNow);

    expect(summary.totalPoints).toBe(0);
    expect(summary.contaminatedPoints).toBe(0);
  });
});

describe("RECOVERY_WINDOW_DAYS", () => {
  it("reaches wider than the 24h the live ingest path segments", () => {
    // The whole reason a drive strands: ingest only ever reconsiders the
    // last 24 hours, so anything older is invisible to it forever.
    expect(RECOVERY_WINDOW_DAYS).toBeGreaterThan(1);
  });

  it("does not reach past the 45-day retention sweep", () => {
    // Beyond this the retention cron has already tombstoned the rows, so
    // claiming to search further would be claiming to search nothing.
    expect(RECOVERY_WINDOW_DAYS).toBeLessThanOrEqual(45);
  });
});

describe("shouldForceCloseRecovery", () => {
  /**
   * The control must force the tail-close, or a drive whose device went
   * dark without ever dwelling can never close and the button is
   * decorative. But forcing it while the driver is MID-DRIVE severs the
   * live drive at whatever point last uploaded, and the remainder becomes
   * a second trip: precisely the fragmentation that shaved deductible
   * connector miles before TRIP_END_DWELL_MS was widened. A driver who
   * taps a button labelled "recover my missing drive" while driving home
   * is not a hypothetical, it is the likeliest way this button is ever
   * pressed.
   */
  const now = Date.parse("2026-08-17T04:07:10.000Z");

  it("forces the close for settled history", () => {
    expect(
      shouldForceCloseRecovery({
        newestUnconsumedTs: now - 6 * 60 * 60_000,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it("refuses to force a close while a drive is still uploading", () => {
    // 37 s, the real margin on 2026-08-17.
    expect(
      shouldForceCloseRecovery({
        newestUnconsumedTs: now - 37_000,
        nowMs: now,
      }),
    ).toBe(false);
  });

  it("waits for the full segmenter dwell before forcing", () => {
    const justInside = shouldForceCloseRecovery({
      newestUnconsumedTs: now - (TRIP_END_DWELL_MS - 1000),
      nowMs: now,
    });
    const justOutside = shouldForceCloseRecovery({
      newestUnconsumedTs: now - TRIP_END_DWELL_MS,
      nowMs: now,
    });

    expect(justInside).toBe(false);
    expect(justOutside).toBe(true);
  });

  it("forces the close when there is nothing staged at all", () => {
    expect(
      shouldForceCloseRecovery({ newestUnconsumedTs: null, nowMs: now }),
    ).toBe(true);
  });
});
