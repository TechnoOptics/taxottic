import { describe, expect, it } from "vitest";
import { LATEST_PUBLISHED_YEAR } from "@/lib/tax/constants";
import { spineYearFor } from "./spine-year";
import { taxYearRunway } from "@/lib/marketing/tax-year-runway";

describe("the spine's year is one we publish due dates for", () => {
  it("clamps a year past the latest published bundle", () => {
    expect(spineYearFor(2030)).toBe(LATEST_PUBLISHED_YEAR);
  });
  it("leaves a published year alone", () => {
    expect(spineYearFor(2026)).toBe(2026);
  });
  it("keeps the runway from throwing on 1 January of an unpublished year", () => {
    const newYear = new Date(`${LATEST_PUBLISHED_YEAR + 1}-01-01T00:00:00Z`);
    expect(() => taxYearRunway(LATEST_PUBLISHED_YEAR + 1, newYear)).toThrow();
    expect(() => taxYearRunway(spineYearFor(LATEST_PUBLISHED_YEAR + 1), newYear)).not.toThrow();
  });
});
