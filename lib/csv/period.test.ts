import { describe, it, expect } from "vitest";
import { formatImportPeriod } from "./period";

describe("formatImportPeriod", () => {
  it("renders a single day", () => {
    expect(formatImportPeriod("2026-03-04", "2026-03-04")).toBe("Mar 4, 2026");
  });

  it("renders a range inside one year", () => {
    expect(formatImportPeriod("2026-01-12", "2026-03-04")).toBe(
      "Jan 12 to Mar 4, 2026",
    );
  });

  it("spells out both years when the range crosses one", () => {
    // A statement spanning a year boundary is exactly when the user needs to
    // see the years, because the two halves land in different tax returns.
    expect(formatImportPeriod("2025-12-12", "2026-01-04")).toBe(
      "Dec 12, 2025 to Jan 4, 2026",
    );
  });

  it("is null when the file had no readable dates", () => {
    expect(formatImportPeriod(null, null)).toBeNull();
    expect(formatImportPeriod("2026-01-01", null)).toBeNull();
    expect(formatImportPeriod(undefined, undefined)).toBeNull();
  });

  it("formats in UTC, so Jan 1 never renders as Dec 31", () => {
    // posted_at is a zoneless date. Parsed in a negative-offset local zone it
    // slips a day, which moves a charge into the previous tax year on screen.
    expect(formatImportPeriod("2026-01-01", "2026-01-01")).toBe("Jan 1, 2026");
  });

  it("tolerates a full timestamp being passed in", () => {
    expect(
      formatImportPeriod("2026-03-04T00:00:00Z", "2026-03-04T00:00:00Z"),
    ).toBe("Mar 4, 2026");
  });
});
