import { describe, it, expect } from "vitest";
import { resolveOverlapAction } from "./finalize";

describe("resolveOverlapAction (finalize dedupe decision)", () => {
  it("no overlaps → insert", () => {
    expect(resolveOverlapAction(5, [])).toEqual({ action: "insert" });
  });

  it("an existing trip at least as full → consume to the fullest keeper", () => {
    const d = resolveOverlapAction(5, [
      { id: "a", miles: 2 },
      { id: "b", miles: 5.001 },
    ]);
    expect(d).toEqual({ action: "consume_to_keeper", keeperId: "b" });
  });

  it("tolerance: equal within 0.005 mi counts as covered (no churn)", () => {
    expect(resolveOverlapAction(5.004, [{ id: "a", miles: 5 }])).toEqual({
      action: "consume_to_keeper",
      keeperId: "a",
    });
  });

  it("candidate meaningfully fuller → replace ALL stale fragments", () => {
    const d = resolveOverlapAction(10, [
      { id: "a", miles: 2 },
      { id: "b", miles: 3 },
    ]);
    expect(d).toEqual({ action: "replace", deleteIds: ["a", "b"] });
  });

  it("NaN/zero-mile fragments never win keeper over a real trip", () => {
    const d = resolveOverlapAction(1, [
      { id: "junk", miles: 0 },
      { id: "real", miles: 1.2 },
    ]);
    expect(d).toEqual({ action: "consume_to_keeper", keeperId: "real" });
  });
});

import { shouldReplaceTrack } from "./finalize";

describe("shouldReplaceTrack (render never-shrink invariant)", () => {
  it("replaces a broken trip with a fuller rebuild", () => {
    expect(shouldReplaceTrack(2, 167)).toBe(true); // Abel's drive
  });

  it("no-op on a healthy trip (equal counts still replace, idempotent)", () => {
    expect(shouldReplaceTrack(130, 130)).toBe(true);
  });

  it("REFUSES to shrink a good trip from a truncated/failed window read", () => {
    expect(shouldReplaceTrack(167, 40)).toBe(false);
    expect(shouldReplaceTrack(130, 129)).toBe(false);
  });

  it("materialises a fresh insert (0 existing) from the raw window", () => {
    expect(shouldReplaceTrack(0, 5)).toBe(true);
  });

  it("never renders a sub-2-point track", () => {
    expect(shouldReplaceTrack(0, 1)).toBe(false);
    expect(shouldReplaceTrack(0, 0)).toBe(false);
  });
});
