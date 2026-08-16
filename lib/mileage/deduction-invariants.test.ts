import { describe, it, expect } from "vitest";
import {
  checkTrip,
  checkTrips,
  correctedCents,
  summarize,
  type TripRow,
} from "./deduction-invariants";

/**
 * The two rows below are the real production violations found on
 * 2026-08-15, reproduced exactly rather than invented. Both would have
 * been carried into a Schedule C, and nothing in the system was capable
 * of noticing either one.
 */

const ok: TripRow = {
  id: "ok",
  classification: "business",
  needs_confirmation: false,
  deduction_cents: 1000,
  distance_miles: 13.8,
};

describe("the two rows production actually had", () => {
  // 13.262 mi x 72.5c = $9.61, i.e. it kept the BUSINESS rate after a
  // human reclassified the drive personal on 2026-07-01.
  const personalKeptBusinessDeduction: TripRow = {
    id: "390980e7-d14d-4f1a-89d5-97e4122699e8",
    classification: "personal",
    needs_confirmation: null,
    deduction_cents: 961,
    distance_miles: 13.262,
  };

  // 10.645 mi x 76c = $8.09, still awaiting the driver's confirmation.
  const unconfirmedGuessWithMoney: TripRow = {
    id: "98f31758-1ac7-499f-8afd-9bcab7c2db81",
    classification: "business",
    needs_confirmation: true,
    deduction_cents: 809,
    distance_miles: 10.645,
  };

  it("catches the personal trip carrying a business deduction", () => {
    const v = checkTrip(personalKeptBusinessDeduction);
    expect(v.map((x) => x.kind)).toEqual(["personal_with_deduction"]);
    expect(v[0].cents).toBe(961);
  });

  it("names the likely cause, not just the rule", () => {
    // A detector that says "invalid" sends someone hunting. This one
    // should point at the reclassification that left the money behind.
    expect(checkTrip(personalKeptBusinessDeduction)[0].detail).toMatch(
      /reclassified/i,
    );
  });

  it("catches the unconfirmed guess carrying money", () => {
    const v = checkTrip(unconfirmedGuessWithMoney);
    expect(v.map((x) => x.kind)).toEqual(["unconfirmed_with_deduction"]);
    expect(v[0].cents).toBe(809);
  });

  it("totals them the way a human would read it", () => {
    const s = summarize(
      checkTrips([personalKeptBusinessDeduction, unconfirmedGuessWithMoney]),
    );
    expect(s).toContain("17.70");
    expect(s).toContain("personal_with_deduction=1");
    expect(s).toContain("unconfirmed_with_deduction=1");
  });
});

describe("what must NOT fire, or the detector becomes noise", () => {
  it("a normal business trip is clean", () => {
    expect(checkTrip(ok)).toEqual([]);
  });

  it("a personal trip with ZERO deduction is exactly right", () => {
    // This is the correct state for every personal drive. Flagging it
    // would fire on the majority of rows and train people to ignore the
    // detector entirely.
    expect(
      checkTrip({ ...ok, classification: "personal", deduction_cents: 0 }),
    ).toEqual([]);
  });

  it("an unconfirmed trip with ZERO deduction is exactly right", () => {
    // 9 of the 10 unconfirmed rows in production look like this.
    expect(
      checkTrip({ ...ok, needs_confirmation: true, deduction_cents: 0 }),
    ).toEqual([]);
  });

  it("a null deduction is treated as zero, not as a violation", () => {
    expect(
      checkTrip({ ...ok, classification: "personal", deduction_cents: null }),
    ).toEqual([]);
  });

  it("needs_confirmation null (pre-migration rows) is not a violation", () => {
    // 119 business rows predate the column. Treating null as true would
    // accuse most of the table.
    expect(checkTrip({ ...ok, needs_confirmation: null })).toEqual([]);
  });

  it("summarises a clean table as ok", () => {
    expect(summarize(checkTrips([ok]))).toBe("ok");
  });
});

describe("rules the audit did not need yet, but the pipeline can break", () => {
  it("unclassified cannot carry a claim", () => {
    const v = checkTrip({ ...ok, classification: "unclassified" });
    expect(v.map((x) => x.kind)).toEqual(["unclassified_with_deduction"]);
  });

  it("a negative deduction is nonsense, not conservatism", () => {
    const v = checkTrip({ ...ok, deduction_cents: -500 });
    expect(v.map((x) => x.kind)).toEqual(["negative_deduction"]);
  });

  it("reports EVERY rule a row breaks, not the first", () => {
    // A row that is both personal and unconfirmed has two separate
    // things wrong. Reporting one hides the other, which is the exact
    // failure this module exists to end.
    const v = checkTrip({
      ...ok,
      classification: "personal",
      needs_confirmation: true,
      deduction_cents: 500,
    });
    expect(v.map((x) => x.kind).sort()).toEqual([
      "personal_with_deduction",
      "unconfirmed_with_deduction",
    ]);
  });
});

describe("the repair can only ever reduce a claim", () => {
  it("proposes zero, and cannot propose anything else", () => {
    const v = checkTrip({ ...ok, classification: "personal" })[0];
    expect(correctedCents(v)).toBe(0);
  });

  it("has no path that increases a deduction", () => {
    // A repair path able to RAISE a claim is a fabrication path, and an
    // automated system that creates overstated deductions is worse than
    // the rows it was built to fix. Enforced by the return type (0) and
    // asserted here so a future edit widening it fails loudly.
    const src = readFileSyncSafe("lib/mileage/deduction-invariants.ts");
    const fn = src.slice(src.indexOf("export function correctedCents"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toMatch(/return 0;/);
    expect(body).not.toMatch(/cents|miles|rate|\*/);
  });
});

function readFileSyncSafe(p: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("node:fs").readFileSync(p, "utf8");
}
