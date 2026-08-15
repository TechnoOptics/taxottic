import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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

// FMEA C6: the re-render path recomputes distance_miles and
// deduction_cents and writes them with no plausibility gate at all
// (isPlausibleTrip guards only the INSERT). needs_confirmation contains
// the money for a drive the machine only GUESSED, but a drive a human
// already CONFIRMED still has its confirmed distance overwritten by
// whatever the rebuild produces, at the full IRS rate.
import {
  assessRenderedTrack,
  describeRenderRefusal,
  isPlausibleTrip as isPlausible,
} from "./finalize";
import type { RawPoint } from "./track";

// One degree of latitude on the same meridian, in miles, using the same
// sphere radius as haversineMeters. Points below are colinear north of
// (30, -97), so their spacing in miles is exact and readable.
const MI_PER_DEG_LAT = (2 * Math.PI * 6_371_000) / 360 / 1609.344;
const T0 = Date.UTC(2026, 6, 20, 12, 0, 0);

/** A rendered fix `minutes` after T0, `miles` north of the origin. */
function pt(minutes: number, miles: number): RawPoint {
  return {
    captured_at: new Date(T0 + minutes * 60_000).toISOString(),
    lat: 30 + miles / MI_PER_DEG_LAT,
    lng: -97,
    speed_mps: null,
    accuracy_m: 5,
  };
}

/** A dense leg: one fix per minute from `fromMin` to `toMin`, moving at
 *  `mph`, starting `atMile` north. Returns the points and the mile the
 *  leg ends on, so a caller can chain legs and know the total. */
function driveLeg(fromMin: number, toMin: number, atMile: number, mph: number) {
  const points: RawPoint[] = [];
  for (let m = fromMin; m <= toMin; m++) {
    points.push(pt(m, atMile + ((m - fromMin) / 60) * mph));
  }
  return { points, endMile: atMile + ((toMin - fromMin) / 60) * mph };
}

describe("assessRenderedTrack (re-render plausibility gate, FMEA C6)", () => {
  it("accepts a healthy dense rebuild", () => {
    const leg = driveLeg(0, 20, 0, 30); // 10 mi in 20 min
    expect(assessRenderedTrack(leg.points, leg.endMile)).toBeNull();
  });

  it("ALLOWS legitimate growth: a keeper absorbing a contiguous fragment", () => {
    // The whole point of renderTripFromRaw. A drive whose points arrived
    // across two flush batches is rebuilt from the union window and the
    // trip grows from 5 miles to 10. Denser and longer, but every mile
    // is witnessed, so the gate must not touch it.
    const before = driveLeg(0, 10, 0, 30);
    const after = driveLeg(0, 20, 0, 30);
    expect(after.endMile).toBeGreaterThan(before.endMile);
    expect(assessRenderedTrack(before.points, before.endMile)).toBeNull();
    expect(assessRenderedTrack(after.points, after.endMile)).toBeNull();
  });

  it("ALLOWS a rebuild that doubles the distance with real fixes behind it", () => {
    // Never-shrink means a rebuild may only add detail. A gate that
    // blocked growth would cause under-claiming, a different failure but
    // still a failure. 60 miles at 60 mph over an hour is a real drive.
    const leg = driveLeg(0, 60, 0, 60);
    expect(leg.endMile).toBeCloseTo(60, 6);
    expect(assessRenderedTrack(leg.points, leg.endMile)).toBeNull();
  });

  it("REFUSES the impossible-average rebuild (the 1,343-mile fabrication)", () => {
    // A time-shifted backlog rendered into a 51-minute window.
    const points = [pt(0, 0), pt(51, 1343.1)];
    const r = assessRenderedTrack(points, 1343.1);
    expect(r?.reason).toBe("implausible_average_speed");
  });

  it("REFUSES a straight line drawn across a capture gap the segmenter would have ended", () => {
    // The C6 mode, and the reason this gate is not just isPlausibleTrip.
    // Two real 5-mile drives 3 hours apart, joined by the union window
    // into one trip. The rebuild draws a 50-mile straight hop across a
    // stretch where the device reported nothing at all.
    const first = driveLeg(0, 10, 0, 30);
    const second = driveLeg(190, 200, 55, 30);
    const points = [...first.points, ...second.points];
    const miles = second.endMile;

    // Average speed alone waves this through: 60 miles over 3h20m.
    expect(isPlausible(miles, T0, T0 + 200 * 60_000)).toBe(true);

    const r = assessRenderedTrack(points, miles);
    expect(r?.reason).toBe("unsupported_gap");
    if (r?.reason !== "unsupported_gap") throw new Error("wrong refusal");
    expect(r.gapMiles).toBeCloseTo(50, 1);
    expect(r.gapMinutes).toBeCloseTo(180, 1);
  });

  it("ALLOWS a long dwell with no movement (parked phone emits no fixes)", () => {
    // The 10-minute TRIP_END_DWELL_MS was widened precisely so a train
    // crossing or drive-through does not sever a drive. At a dead stop
    // the 25 m distanceFilter emits nothing, so the rendered track has a
    // long gap carrying no distance. That is evidence of parking, not a
    // fabricated hop, and must stay allowed.
    const before = driveLeg(0, 10, 0, 30);
    const after = driveLeg(35, 45, before.endMile, 30);
    const points = [...before.points, ...after.points];
    expect(assessRenderedTrack(points, after.endMile)).toBeNull();
  });

  it("ALLOWS a gap inside MAX_CAPTURE_GAP_MS, which the segmenter itself allows", () => {
    const first = driveLeg(0, 10, 0, 30);
    const second = driveLeg(17, 27, first.endMile + 3, 30);
    const points = [...first.points, ...second.points];
    expect(assessRenderedTrack(points, second.endMile)).toBeNull();
  });

  it("ALLOWS a sub-MIN_TRIP_METERS drift across a long gap (noise, not a drive)", () => {
    const first = driveLeg(0, 10, 0, 30);
    const second = driveLeg(60, 70, first.endMile + 0.1, 30); // 161 m
    const points = [...first.points, ...second.points];
    expect(assessRenderedTrack(points, second.endMile)).toBeNull();
  });

  it("cannot refuse a track too short to render (caller already bails)", () => {
    expect(assessRenderedTrack([pt(0, 0)], 0)).toBeNull();
    expect(assessRenderedTrack([], 0)).toBeNull();
  });
});

describe("describeRenderRefusal (a refusal nobody can see is how this survives)", () => {
  it("names the mode, the miles refused and the miles kept", () => {
    const msg = describeRenderRefusal(
      { reason: "unsupported_gap", miles: 60, gapMiles: 50, gapMinutes: 180 },
      12.5,
    );
    expect(msg).toContain("unsupported_gap");
    expect(msg).toContain("60.00");
    expect(msg).toContain("50.00");
    expect(msg).toContain("180");
    expect(msg).toContain("12.50");
  });

  it("reports an unknown kept distance rather than inventing a zero", () => {
    const msg = describeRenderRefusal(
      { reason: "implausible_average_speed", miles: 1343.1, minutes: 51 },
      null,
    );
    expect(msg).toContain("implausible_average_speed");
    expect(msg).toContain("1343.10");
    expect(msg).not.toContain("0.00 mi");
  });
});

/**
 * The gate above is thoroughly tested AS A FUNCTION, and that is not the
 * same as being applied.
 *
 * Deleting the `assessRenderedTrack` call from `renderTripFromRaw`
 * entirely left all 32 tests in this file passing, because every test
 * calls the gate directly and none of them proves the render path
 * consults it. A refactor that dropped the call would restore the
 * $1,875 fabrication with a green suite.
 *
 * This is the fourth instance of one defect shape found on 2026-08-15:
 * the module is correct and the CALL SITE is unguarded. Here it guards a
 * tax record, so it gets a positional assertion rather than a
 * presence-only one: the safety argument depends on the gate running
 * BEFORE the destructive delete, not merely somewhere in the function.
 */
describe("the render path actually consults the gate", () => {
  const SRC = readFileSync("lib/mileage/finalize.ts", "utf8");
  const body = (() => {
    const i = SRC.indexOf("async function renderTripFromRaw");
    const rest = SRC.slice(i + 10);
    const m = rest.match(/\n(?:export )?(?:async )?function /);
    return SRC.slice(i, m ? i + 10 + m.index! : SRC.length);
  })();

  it("calls assessRenderedTrack on the rebuilt track", () => {
    expect(body).toContain(
      "assessRenderedTrack(track.points, track.distanceMiles)",
    );
  });

  it("gates BEFORE deleting the existing points, not after", () => {
    // A refusal must leave the trip exactly as it was. Gating after the
    // delete would destroy the human-blessed track and then decline to
    // replace it, which is worse than the bug being prevented.
    const gate = body.indexOf("assessRenderedTrack(");
    const del = body.indexOf(".delete()");
    expect(gate).toBeGreaterThan(-1);
    expect(del).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(del);
  });

  it("gates AFTER the never-shrink check, so a refusal cannot widen it", () => {
    const shrink = body.indexOf("shouldReplaceTrack(");
    const gate = body.indexOf("assessRenderedTrack(");
    expect(shrink).toBeGreaterThan(-1);
    expect(shrink).toBeLessThan(gate);
  });

  it("records the refusal and returns without writing", () => {
    const gate = body.indexOf("assessRenderedTrack(");
    const del = body.indexOf(".delete()");
    const between = body.slice(gate, del);
    // Observable: a frozen trip must be findable, not silent.
    expect(between).toContain("recordRenderRefusal(");
    expect(between).toMatch(/return null;/);
  });
});
