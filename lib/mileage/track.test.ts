import { describe, it, expect } from "vitest";
import { buildTrackFromRaw, type RawPoint } from "./track";

const p = (
  captured_at: string,
  lat: number,
  lng: number,
  accuracy_m: number | null = 4,
): RawPoint => ({ captured_at, lat, lng, speed_mps: null, accuracy_m });

describe("buildTrackFromRaw", () => {
  it("orders points by timestamp and sums haversine distance", () => {
    const t = buildTrackFromRaw([
      p("2026-07-15T14:20:00Z", 44.7611, -93.4728),
      p("2026-07-15T14:19:00Z", 44.7617, -93.4727),
    ]);
    expect(t.points.map((x) => x.captured_at)).toEqual([
      "2026-07-15T14:19:00Z",
      "2026-07-15T14:20:00Z",
    ]);
    expect(t.distanceMiles).toBeGreaterThan(0);
  });

  it("drops fixes worse than the accuracy threshold", () => {
    const t = buildTrackFromRaw([
      p("2026-07-15T14:19:00Z", 44.7617, -93.4727, 4),
      p("2026-07-15T14:19:05Z", 44.9999, -93.9999, 250), // junk fix
      p("2026-07-15T14:19:10Z", 44.7620, -93.4720, 6),
    ]);
    expect(t.points).toHaveLength(2);
  });

  it("de-dupes a timestamp, keeping the best-accuracy fix", () => {
    const t = buildTrackFromRaw([
      p("2026-07-15T14:19:00Z", 44.7617, -93.4727, 30),
      p("2026-07-15T14:19:00Z", 44.7618, -93.4726, 4),
    ]);
    expect(t.points).toHaveLength(1);
    expect(t.points[0].accuracy_m).toBe(4);
  });

  it("the orphaned-batch scenario: a mid-window point is included", () => {
    // start, [orphaned middle], resume — all in one window
    const t = buildTrackFromRaw([
      p("2026-07-15T14:19:35Z", 44.76174, -93.47278),
      p("2026-07-15T14:22:00Z", 44.77055, -93.46946), // was orphaned
      p("2026-07-15T14:25:06Z", 44.78318, -93.43796),
    ]);
    expect(t.points).toHaveLength(3);
    // includes the middle → no single giant straight hop
    expect(t.distanceMiles).toBeGreaterThan(1);
  });

  it("tolerates empty / single-point input", () => {
    expect(buildTrackFromRaw([]).distanceMiles).toBe(0);
    expect(buildTrackFromRaw([p("2026-07-15T14:19:00Z", 44.76, -93.47)]).points).toHaveLength(1);
    expect(buildTrackFromRaw([p("2026-07-15T14:19:00Z", 44.76, -93.47)]).distanceMiles).toBe(0);
  });

  it("skips non-finite coordinates", () => {
    const t = buildTrackFromRaw([
      p("2026-07-15T14:19:00Z", 44.76, -93.47),
      p("2026-07-15T14:19:05Z", NaN, -93.47),
    ]);
    expect(t.points).toHaveLength(1);
  });
});

// 2026-07-27 "messy lines": 50-99m-accuracy scatter from a slow errand
// drive rendered as zigzag scribbles. The render pass now drops
// noise-circle bounce while keeping real movement and dwell anchors.
describe("render jitter suppression", () => {
  const t0 = Date.parse("2026-07-27T18:00:00Z");
  const mk = (i: number, lat: number, lng: number, acc: number) => ({
    captured_at: new Date(t0 + i * 10_000).toISOString(),
    lat, lng, accuracy_m: acc, speed_mps: 1,
  });

  it("drops sub-noise scatter but keeps real travel", () => {
    // ~40m-accuracy fixes (inside the render cap) bouncing ~20m apart
    // (pure noise), then a real 500m move with clean fixes.
    const jitter = [
      mk(0, 44.0, -93.0, 40),
      mk(1, 44.00018, -93.0, 40),   // ~20m bounce < 40m noise
      mk(2, 44.0, -93.00025, 40),   // ~20m bounce < 40m noise
      mk(3, 44.00448, -93.0, 10),   // ~500m real move, clean fix
      mk(4, 44.00897, -93.0, 10),   // another 500m
    ];
    const track = buildTrackFromRaw(jitter);
    // The two bounces vanish; anchor + the two clean fixes remain.
    expect(track.points.length).toBe(3);
    expect(track.distanceMiles).toBeGreaterThan(0.5);
    expect(track.distanceMiles).toBeLessThan(0.75);
  });

  it("accuracy worse than the render cap never draws", () => {
    const track = buildTrackFromRaw([
      mk(0, 44.0, -93.0, 10),
      mk(1, 44.001, -93.0, 90),  // over 60m render cap
      mk(2, 44.002, -93.0, 10),
    ]);
    expect(track.points.length).toBe(2);
  });

  it("falls back to unfiltered when the filter would leave <2 points", () => {
    const track = buildTrackFromRaw([
      mk(0, 44.0, -93.0, 90),
      mk(1, 44.0001, -93.0, 90),
    ]);
    expect(track.points.length).toBe(2);
  });
});
