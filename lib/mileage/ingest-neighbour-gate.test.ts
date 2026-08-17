import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { NEIGHBOUR_ROW_CAP, NEIGHBOUR_WINDOW_MS } from "./plausible-jump";

/**
 * Call-site guard for the stored-neighbour gate.
 *
 * lib/mileage/plausible-jump.test.ts proves the rule. This proves the
 * door actually uses it, which is the half that failed on 2026-08-17:
 * rejectImplausibleJumps was correct, tested, and called on every
 * ingest, and it still could not see the teleport, because the caller
 * only ever showed it ONE stored point (the newest) and then discarded
 * even that whenever the batch was older than it. The module was never
 * wrong. The argument it was handed was.
 *
 * So the assertions here are about the argument. A window read that
 * silently returns nothing, is scoped to the wrong driver, or is fetched
 * but not passed, restores the exact blind spot while every unit test
 * in the suite stays green.
 *
 * Comments are stripped before every assertion. This repo has twice
 * shipped a guard that matched a doc comment while the code did
 * something else, and this route is heavily commented, including
 * comments that name the very functions being searched for.
 */

const ROUTE = "app/api/mileage/ingest/route.ts";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

const code = stripComments(readFileSync(ROUTE, "utf8"));

/** The neighbour query, up to the gate call that consumes it. */
function neighbourQuery(): string {
  const at = code.indexOf("storedNeighbours");
  expect(at, "the neighbour window read is gone, the gate is blind again").toBeGreaterThan(-1);
  const end = code.indexOf("rejectImplausibleJumps(");
  expect(end).toBeGreaterThan(at);
  return code.slice(at, end);
}

describe("the ingest route shows the gate the points the batch lands among", () => {
  it("passes the stored window as the gate's third argument", () => {
    // The load-bearing line. Everything else here is about that
    // argument being worth passing.
    expect(code).toMatch(
      /rejectImplausibleJumps\(\s*points,\s*anchor,\s*storedNeighbours\s*\)/,
    );
  });

  it("reads a window on BOTH sides of the batch", () => {
    // A backwards-only window leaves every leading edge unwitnessed: a
    // point can be perfectly reachable from the last stored point
    // before it and still be somewhere the car provably was not,
    // because the stored point seconds later is miles away.
    const q = neighbourQuery();
    expect(q, "no lower bound, the window is unbounded or one-sided").toMatch(
      /gte\(\s*"captured_at"/,
    );
    expect(q, "no upper bound, the successor witness is missing").toMatch(
      /lte\(\s*"captured_at"/,
    );
  });

  it("centres that window on the batch, not on now", () => {
    // The batch that caused this arrived 26 minutes after the points it
    // conflicted with. A window measured from Date.now() would miss
    // them by design.
    const q = neighbourQuery();
    expect(q).toContain("points[0].ts - NEIGHBOUR_WINDOW_MS");
    expect(q).toContain("points[points.length - 1].ts + NEIGHBOUR_WINDOW_MS");
  });

  it("scopes the window to this driver and this company", () => {
    // Without both, one driver's points become another's witnesses:
    // every colleague in a different city reads as a teleport, and the
    // gate would refuse genuine drives wholesale.
    const q = neighbourQuery();
    expect(q).toMatch(/eq\(\s*"driver_user_id",\s*user\.id\s*\)/);
    expect(q).toMatch(/eq\(\s*"company_id",\s*companyId\s*\)/);
  });

  it("still keeps the single-row anchor for the batch's own chain", () => {
    // The window and the anchor answer different questions and the
    // window cannot replace the anchor: a phone that has been off for
    // longer than the window comes back with no stored neighbour at
    // all, and the intra-batch chain is then the only check left.
    expect(code).toContain('order("captured_at", { ascending: false })');
    expect(code).toMatch(/const anchor =/);
  });

  it("bounds the read so a wide backlog cannot fetch the whole table", () => {
    expect(neighbourQuery()).toContain("limit(NEIGHBOUR_ROW_CAP)");
  });

  it("says so when the window read fails instead of failing open silently", () => {
    // A swallowed error nulls the witnesses and the gate degrades to
    // exactly the behaviour that lost the drive, with nothing in the
    // logs to say it happened.
    expect(neighbourQuery()).toMatch(/neighbourErr/);
  });
});

describe("the window is wide enough to witness and narrow enough to bound", () => {
  it("spans longer than any stored point could still constrain", () => {
    // At the 89 m/s bar, 15 minutes reaches 80 km. A stored point
    // further away in time than that cannot make anything within the
    // batch implausible, so fetching it would cost rows and prove
    // nothing.
    expect(NEIGHBOUR_WINDOW_MS).toBeGreaterThanOrEqual(10 * 60_000);
    expect(NEIGHBOUR_WINDOW_MS).toBeLessThanOrEqual(60 * 60_000);
  });

  it("caps the read above a full day of fixes", () => {
    // The device captures at roughly 4.8 s, so 24 hours is about 18,000
    // rows. A cap below that would silently truncate the witnesses for
    // the late half of a long backlog.
    expect(NEIGHBOUR_ROW_CAP).toBeGreaterThan((24 * 60 * 60) / 4.8);
  });
});
