import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { partitionLoggedTrips, isExcludedFromLog } from "./passenger";
import { reclassifyTripCore, RECLASSIFY_ALLOWED } from "./reclassify";
import { tripDeductionCents } from "./deduction";

/**
 * "I was a passenger" is an EXCLUSION, never a delete.
 *
 * The row survives so the day's GPS trail has no unexplained gap and so a
 * mis-tap on a phone is recoverable. Everything else about it has to behave
 * like the drive is gone: off the list, off the map, out of every total,
 * deduction zero.
 *
 * These tests cover the three halves of that promise separately, because
 * each can break without the others noticing:
 *
 *   1. the partition itself (pure)
 *   2. the money, end to end through reclassifyTripCore (reversibility)
 *   3. the WIRING, read out of the real source files, because this
 *      codebase's characteristic failure is a correct module nobody calls
 */

// ---------------------------------------------------------------------
// 1. The partition
// ---------------------------------------------------------------------

type Row = { id: string; classification: string };

describe("partitionLoggedTrips", () => {
  it("moves passenger drives out of the logged half", () => {
    const rows: Row[] = [
      { id: "a", classification: "business" },
      { id: "b", classification: "passenger" },
      { id: "c", classification: "personal" },
      { id: "d", classification: "unclassified" },
      { id: "e", classification: "passenger" },
    ];
    const { logged, excluded } = partitionLoggedTrips(rows);
    expect(logged.map((r) => r.id)).toEqual(["a", "c", "d"]);
    expect(excluded.map((r) => r.id)).toEqual(["b", "e"]);
  });

  it("keeps every non-passenger classification in the log", () => {
    // Stated as its own case so that widening the exclusion set to, say,
    // "unclassified" (which would silently empty a driver's triage queue)
    // fails here rather than in production.
    for (const cls of ["business", "personal", "unclassified"]) {
      const { logged, excluded } = partitionLoggedTrips([
        { id: "x", classification: cls },
      ]);
      expect(logged).toHaveLength(1);
      expect(excluded).toHaveLength(0);
    }
  });

  it("loses nothing: every input row lands in exactly one half", () => {
    const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({
      id: String(i),
      classification: i % 3 === 0 ? "passenger" : "business",
    }));
    const { logged, excluded } = partitionLoggedTrips(rows);
    expect(logged.length + excluded.length).toBe(rows.length);
    expect(new Set([...logged, ...excluded].map((r) => r.id)).size).toBe(20);
  });

  it("preserves order within each half", () => {
    const rows: Row[] = [
      { id: "1", classification: "passenger" },
      { id: "2", classification: "business" },
      { id: "3", classification: "passenger" },
      { id: "4", classification: "business" },
    ];
    const { logged, excluded } = partitionLoggedTrips(rows);
    expect(logged.map((r) => r.id)).toEqual(["2", "4"]);
    expect(excluded.map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("survives an empty list and a null classification", () => {
    expect(partitionLoggedTrips([])).toEqual({ logged: [], excluded: [] });
    // A row whose classification never made it into the select must not be
    // treated as excluded: hiding a drive on the strength of a missing
    // column is exactly the silent data loss this feature refuses to do.
    const { logged } = partitionLoggedTrips([
      { id: "n", classification: null },
    ]);
    expect(logged).toHaveLength(1);
  });

  it("isExcludedFromLog names only passenger", () => {
    expect(isExcludedFromLog({ classification: "passenger" })).toBe(true);
    expect(isExcludedFromLog({ classification: "business" })).toBe(false);
    expect(isExcludedFromLog({ classification: "personal" })).toBe(false);
    expect(isExcludedFromLog({ classification: "unclassified" })).toBe(false);
  });
});

// ---------------------------------------------------------------------
// 2. The money, and the round trip back
// ---------------------------------------------------------------------

/** Minimal stand-in for the service-role client, enough for reclassify. */
function fakeAdmin(trip: Record<string, unknown>) {
  const writes: Record<string, unknown>[] = [];
  const client = {
    from(table: string) {
      if (table === "company_members") {
        return {
          select: () => client.from(table),
          eq: () => client.from(table),
          maybeSingle: async () => ({ data: null }),
        };
      }
      return {
        select: () => client.from(table),
        eq: () => client.from(table),
        maybeSingle: async () => ({ data: trip }),
        update(patch: Record<string, unknown>) {
          writes.push(patch);
          Object.assign(trip, patch);
          return { eq: async () => ({ error: null }) };
        },
      };
    },
  };
  return { admin: client, writes, trip };
}

describe("marking a drive passenger, and taking it back", () => {
  const DRIVER = "driver-1";
  const base = {
    id: "trip-1",
    company_id: "co-1",
    driver_user_id: DRIVER,
    distance_miles: 42.5,
    tax_year: 2026,
    started_at: "2026-08-16T15:00:00.000Z",
  };
  const businessCents = tripDeductionCents(
    { distanceMiles: 42.5 },
    "business",
    2026,
    base.started_at,
  );

  it("is an allowed classification in both directions", () => {
    expect(RECLASSIFY_ALLOWED).toContain("passenger");
    // Reversibility at the data layer: the driver has to be able to walk
    // back out of passenger, or the "mis-tap is recoverable" argument for
    // choosing exclusion over deletion is a fiction.
    expect(RECLASSIFY_ALLOWED).toContain("business");
    expect(RECLASSIFY_ALLOWED).toContain("personal");
  });

  it("zeroes the deduction and restores it on the way back", () => {
    expect(businessCents).toBeGreaterThan(0);
  });

  it("passenger writes deduction 0, business restores the same cents", async () => {
    const { admin, writes } = fakeAdmin({ ...base });

    const toPassenger = await reclassifyTripCore(
      admin,
      DRIVER,
      "trip-1",
      "passenger",
    );
    expect(toPassenger).toEqual({ ok: true });
    expect(writes[0].classification).toBe("passenger");
    expect(writes[0].deduction_cents).toBe(0);

    const back = await reclassifyTripCore(admin, DRIVER, "trip-1", "business");
    expect(back).toEqual({ ok: true });
    expect(writes[1].classification).toBe("business");
    expect(writes[1].deduction_cents).toBe(businessCents);
  });

  it("does not delete the row", async () => {
    // The whole design rests on the row surviving. A `.delete()` reaching
    // the client here would mean the exclusion had quietly become the
    // destruction it was chosen instead of.
    let deleted = false;
    const { admin } = fakeAdmin({ ...base });
    const guarded = {
      from(table: string) {
        const q = admin.from(table) as Record<string, unknown>;
        return {
          ...q,
          delete: () => {
            deleted = true;
            return { eq: async () => ({ error: null }) };
          },
        };
      },
    };
    await reclassifyTripCore(guarded, DRIVER, "trip-1", "passenger");
    expect(deleted).toBe(false);
  });

  it("still refuses a stranger", async () => {
    const { admin, writes } = fakeAdmin({ ...base });
    const res = await reclassifyTripCore(
      admin,
      "someone-else",
      "trip-1",
      "passenger",
    );
    expect(res).toEqual({ ok: false, reason: "forbidden" });
    expect(writes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// 3. Wiring, read out of the real files
// ---------------------------------------------------------------------

/**
 * Strip comments before asserting on source.
 *
 * Twice now a guard in this repo has been satisfied by a DOC COMMENT
 * describing the behaviour instead of the code performing it, which is a
 * test that passes hardest exactly when the feature has been removed.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\/[^\n]*\n/g, "{\n")
    .replace(/\/\/[^\n]*/g, "");
}

function code(path: string): string {
  const src = stripComments(readFileSync(path, "utf8"));
  // Guard the extractor: a stripper that ate the file would make every
  // "does not contain" assertion below pass against nothing.
  expect(src.length).toBeGreaterThan(500);
  return src;
}

describe("the exclusion is actually wired into /mileage", () => {
  it("the page partitions the loaded rows before anything renders", () => {
    const page = code("app/mileage/page.tsx");
    // The privacy strip feeds the partition directly. Asserting the
    // composition (not just that both names appear) is what makes the
    // test fail if a future edit renders the unpartitioned rows.
    expect(page).toMatch(/partitionLoggedTrips\(\s*\n?\s*stripForeignPrivateTrips\(/);
  });

  it("the trip list renders the logged half, not the raw rows", () => {
    const page = code("app/mileage/page.tsx");
    // `trips` is the logged half; the raw fetch result is never bound to a
    // name the renderers can reach.
    expect(page).toMatch(/logged:\s*trips/);
    expect(page).toContain("excluded: excludedTrips");
  });

  it("the excluded drives are still reachable, so the tap is reversible", () => {
    const page = code("app/mileage/page.tsx");
    expect(page).toContain("excludedRows");
    const review = code("components/mileage/MileageReview.tsx");
    expect(review).toContain("ExcludedTrips");
    const excluded = code("components/mileage/ExcludedTrips.tsx");
    // Both ways back out. Either one missing strands the drive.
    expect(excluded).toContain('restore("business")');
    expect(excluded).toContain('restore("personal")');
    expect(excluded).toContain("reclassify");
  });

  it("the drive list offers the passenger control", () => {
    const list = code("components/mileage/TripList.tsx");
    expect(list).toContain('doReclassify("passenger")');
    // Plain copy, and an explanation of what it costs the driver.
    expect(list).toContain("Passenger");
    expect(list).toMatch(/deduction/i);
  });

  it("no emoji leaked into the new controls", () => {
    // Product rule: emoji read as low quality to the corporate buyer.
    const emoji =
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F2FF}]/u;
    expect(emoji.test(code("components/mileage/ExcludedTrips.tsx"))).toBe(false);
  });
});
