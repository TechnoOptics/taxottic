import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * THE INVARIANT: the drive log's first byte does not wait on map
 * thumbnails.
 *
 * The page used to call the mileage_trip_polylines RPC for every trip in
 * the range at up to 250 points each, and page the result in 1000-row
 * chunks in a loop bounded at 60,000 rows: up to sixty sequential
 * database round trips, awaited in full, before anything rendered, for
 * thumbnails on rows the reader may never scroll to. That is the "slow
 * to load drives" report.
 *
 * These are source guards rather than behaviour tests because the cost
 * being guarded is the presence of the call itself, on the render path,
 * which no assertion over the rendered output can see.
 */
const PAGE = readFileSync("app/mileage/page.tsx", "utf8");

describe("first paint is the drives", () => {
  it("fetches no polylines on the render path", () => {
    expect(
      PAGE,
      "the page blocked its first byte on up to sixty sequential polyline " +
        "requests, for thumbnails on rows nobody had scrolled to yet",
    ).not.toMatch(/mileage_trip_polylines/);
  });

  it("keeps no paging loop over a point table", () => {
    expect(PAGE).not.toMatch(/POLY_PAGE/);
    expect(PAGE).not.toMatch(/60_000/);
  });

  it("loads drives through the no-window contract", () => {
    expect(PAGE).toMatch(/loadDrivePage/);
  });

  it("has a skeleton to show while it loads", () => {
    expect(() => readFileSync("app/mileage/loading.tsx", "utf8")).not.toThrow();
  });
});
