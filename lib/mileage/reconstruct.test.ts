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
