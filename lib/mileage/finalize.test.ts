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

// audit #34: a US evening drive on Dec 31 is already Jan 1 in UTC, so a
// UTC-derived tax year filed the deduction under the wrong return.
import { localTaxYear } from "./finalize";

describe("localTaxYear (audit #34)", () => {
  it("Dec 31 evening in US-Central stays in that tax year", () => {
    // 2026-12-31 20:00 CST == 2027-01-01 02:00 UTC
    const ms = Date.parse("2027-01-01T02:00:00Z");
    expect(new Date(ms).getUTCFullYear()).toBe(2027); // the old, wrong answer
    expect(localTaxYear(ms)).toBe(2026);
  });

  it("a genuine January drive is the new year", () => {
    expect(localTaxYear(Date.parse("2027-01-02T18:00:00Z"))).toBe(2027);
  });
});

// Plausibility gate: fabricated trips (timestamp poisoning, teleports)
// must die at creation, never reach a user's phone. Live incident: 808,
// 314 and 1,343-"mile" trips in one evening from a time-shifted backlog.
import { isPlausibleTrip } from "./finalize";

describe("isPlausibleTrip", () => {
  const MIN = 60_000;
  it("a normal commute passes", () => {
    expect(isPlausibleTrip(12, 0, 25 * MIN)).toBe(true); // ~29 mph
  });
  it("a fast interstate leg passes", () => {
    expect(isPlausibleTrip(85, 0, 60 * MIN)).toBe(true); // 85 mph
  });
  it("the 1,343-mile 51-minute fabrication is rejected", () => {
    expect(isPlausibleTrip(1343.1, 0, 51 * MIN)).toBe(false);
  });
  it("a 1.6-mile 36-second teleport is rejected", () => {
    expect(isPlausibleTrip(1.6, 0, 36_000)).toBe(false); // 163 mph
  });
  it("degenerate zero-duration cannot divide by zero (floored to 30s)", () => {
    // The 30s floor turns a half-mile zero-duration blip into 60 mph —
    // deliberately tolerated; the segmenter's own point/duration minimums
    // are the filter for those. What matters is no NaN/Infinity escape.
    expect(isPlausibleTrip(0.5, 0, 0)).toBe(true);
    expect(isPlausibleTrip(2, 0, 0)).toBe(false); // 240 mph even floored
  });
});

// A drive the machine ASSUMED is business (the place heuristic could not
// decide, so the blanket default fired) carries no evidence, and an
// over-claim is an IRS problem while an under-claim is only money left on
// the table. It is stored at zero cents until a human confirms it, which
// keeps it out of every deduction rollup in the app without touching any
// money math: they all sum stored deduction_cents filtered to business.
import { persistedDeductionCents } from "./finalize";

describe("persistedDeductionCents (assumed drives claim nothing)", () => {
  it("an assumed-business drive stores zero, whatever the rate says", () => {
    expect(persistedDeductionCents(254, true)).toBe(0);
  });

  it("an evidence-backed drive stores its real deduction", () => {
    expect(persistedDeductionCents(254, false)).toBe(254);
  });

  it("a pre-existing row (flag NULL) is untouched, no silent backfill", () => {
    expect(persistedDeductionCents(254, null)).toBe(254);
  });

  it("holds on the RE-RENDER path too: a rebuild cannot restore cents", () => {
    // renderTripFromRaw recomputes distance and deduction from the raw
    // window with no plausibility gate, which is how 808, 314 and 1,343
    // "mile" trips once became $1,875 of false deduction. While the drive
    // is unconfirmed the rebuild can grow the miles but never the claim.
    expect(persistedDeductionCents(101_875, true)).toBe(0);
  });
});
