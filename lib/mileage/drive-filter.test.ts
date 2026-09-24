import { describe, it, expect } from "vitest";
import { filterDrives, coversWindow } from "./drive-filter";

const NOW = new Date("2026-09-22T12:00:00.000Z").getTime();
/**
 * Four drives, chosen so every window both keeps and drops something:
 * 0.1 days old, 4.1, 21.1 and 80.1. The brief's own fixture put its
 * oldest drive 33.1 days back and expected the 31 day window to keep
 * it, which its own window table cannot do; that drive is 21.1 days old
 * here and a fourth, genuinely outside the month, proves the exclusion
 * the original three could not.
 */
const drives = [
  { id: "a", started_at: "2026-09-22T09:00:00.000Z" },
  { id: "b", started_at: "2026-09-18T09:00:00.000Z" },
  { id: "c", started_at: "2026-09-01T09:00:00.000Z" },
  { id: "d", started_at: "2026-07-04T09:00:00.000Z" },
];

describe("the filter runs over what is loaded", () => {
  it("all keeps everything, in order", () => {
    expect(filterDrives(drives, "all", NOW).map((d) => d.id)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("week keeps the last seven days", () => {
    expect(filterDrives(drives, "week", NOW).map((d) => d.id)).toEqual(["a", "b"]);
  });

  it("month keeps the last thirty-one days", () => {
    expect(filterDrives(drives, "month", NOW).map((d) => d.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("says when a window reaches past the oldest drive it holds", () => {
    // The oldest loaded drive is 2026-07-04, so a quarter window starts
    // before anything loaded and the list would understate the total.
    expect(coversWindow(drives, "quarter", NOW)).toBe(false);
    expect(coversWindow(drives, "week", NOW)).toBe(true);
  });

  it("covers any window when nothing is loaded, rather than claiming a gap", () => {
    expect(coversWindow([], "quarter", NOW)).toBe(true);
  });
});
