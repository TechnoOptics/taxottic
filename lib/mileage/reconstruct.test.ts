import { describe, it, expect } from "vitest";
import { overlapsExistingTrip, type TripWindow } from "./reconstruct";

const T = (startTs: number, endTs: number): TripWindow => ({ startTs, endTs });

describe("overlapsExistingTrip (recovery duplicate guard)", () => {
  it("the reported bug: a straddle jump spanning a finalized trip overlaps", () => {
    // Real trip 14:14→14:59; parked heartbeats at 14:13 and 15:10 read
    // as a 'jump' — must be treated as already covered.
    const real = T(1414, 1459);
    expect(overlapsExistingTrip(1413, 1510, [real])).toBe(true);
  });

  it("partial overlaps on either edge count", () => {
    const trip = T(100, 200);
    expect(overlapsExistingTrip(50, 150, [trip])).toBe(true);
    expect(overlapsExistingTrip(150, 250, [trip])).toBe(true);
  });

  it("a jump fully inside an existing trip overlaps", () => {
    expect(overlapsExistingTrip(120, 180, [T(100, 200)])).toBe(true);
  });

  it("a genuinely-missed drive (no trip in its window) does not overlap", () => {
    expect(
      overlapsExistingTrip(300, 400, [T(100, 200), T(500, 600)]),
    ).toBe(false);
  });

  it("touching endpoints count as overlap (conservative: never duplicate)", () => {
    expect(overlapsExistingTrip(200, 300, [T(100, 200)])).toBe(true);
  });

  it("no existing trips → recoverable", () => {
    expect(overlapsExistingTrip(0, 10, [])).toBe(false);
  });
});

import { buildApproxChains } from "./reconstruct";

// Fixes positioned by "meters north of origin": 1 deg lat = 111,320 m.
const P = (id: string, tSec: number, northM: number) => ({
  id,
  ts: tSec * 1000,
  lat: northM / 111_320,
  lng: 0,
});

describe("buildApproxChains (sparse-trace recovery)", () => {
  it("a sparse drive (fix every 2 min) becomes ONE chain with the full trace", () => {
    const pts = [0, 1, 2, 3, 4, 5].map((i) => P(`p${i}`, i * 120, i * 1500));
    const chains = buildApproxChains(pts);
    expect(chains).toHaveLength(1);
    expect(chains[0].startIdx).toBe(0);
    expect(chains[0].endIdx).toBe(5);
    expect(chains[0].meters).toBeGreaterThan(7000);
  });

  it("parked heartbeats never form a chain", () => {
    const pts = [0, 1, 2, 3].map((i) => P(`h${i}`, i * 120, i * 10));
    expect(buildApproxChains(pts)).toHaveLength(0);
  });

  it("the classic stop-to-stop teleport still yields a 2-point chain", () => {
    const pts = [P("a", 0, 0), P("b", 1800, 10_000)];
    const chains = buildApproxChains(pts);
    expect(chains).toHaveLength(1);
    expect(chains[0].startIdx).toBe(0);
    expect(chains[0].endIdx).toBe(1);
  });

  it("bridges a red-light pause (short stationary leg mid-drive)", () => {
    const pts = [
      P("a", 0, 0),
      P("b", 120, 1500),
      P("c", 240, 1520), // ~20 m in 2 min: stopped
      P("d", 360, 3000),
      P("e", 480, 4500),
    ];
    const chains = buildApproxChains(pts);
    expect(chains).toHaveLength(1);
    expect(chains[0].startIdx).toBe(0);
    expect(chains[0].endIdx).toBe(4);
  });

  it("a long stop (> pause budget) splits the drive into two chains", () => {
    const pts = [
      P("a", 0, 0),
      P("b", 120, 1500),
      // parked 10 min (two stationary legs of 300s each)
      P("c", 420, 1510),
      P("d", 720, 1520),
      P("e", 840, 3000),
      P("f", 960, 4500),
    ];
    const chains = buildApproxChains(pts);
    expect(chains).toHaveLength(2);
    expect(chains[0].endIdx).toBe(1);
    expect(chains[1].startIdx).toBe(3);
  });

  it("trims trailing stationary fixes off the chain end", () => {
    const pts = [
      P("a", 0, 0),
      P("b", 120, 1500),
      P("c", 240, 3000),
      P("d", 360, 3010), // arrived, heartbeat
    ];
    const chains = buildApproxChains(pts);
    expect(chains).toHaveLength(1);
    expect(chains[0].endIdx).toBe(2);
  });

  it("total movement under 1 km is jitter, not a drive", () => {
    const pts = [P("a", 0, 0), P("b", 130, 400), P("c", 260, 800)];
    expect(buildApproxChains(pts)).toHaveLength(0);
  });
});
