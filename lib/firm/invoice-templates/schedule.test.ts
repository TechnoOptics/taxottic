import { describe, it, expect } from "vitest";
import { computeNextIssueAt } from "./schedule";

describe("computeNextIssueAt", () => {
  it("monthly + day-1 + reference before day-1 → same month", () => {
    const next = computeNextIssueAt({
      cadence: "monthly",
      issueDayOfMonth: 1,
      // June 30, 2026 → next is July 1, 2026
      reference: new Date(Date.UTC(2026, 5, 30, 23, 0, 0)),
    });
    expect(next.getUTCFullYear()).toBe(2026);
    expect(next.getUTCMonth()).toBe(6); // July
    expect(next.getUTCDate()).toBe(1);
  });

  it("monthly + day-1 + reference AFTER day-1 → next month", () => {
    const next = computeNextIssueAt({
      cadence: "monthly",
      issueDayOfMonth: 1,
      // July 5, 2026 → next is August 1, 2026
      reference: new Date(Date.UTC(2026, 6, 5)),
    });
    expect(next.getUTCMonth()).toBe(7); // August
    expect(next.getUTCDate()).toBe(1);
  });

  it("quarterly + day-15 + reference mid-quarter → adds 3 months", () => {
    const next = computeNextIssueAt({
      cadence: "quarterly",
      issueDayOfMonth: 15,
      reference: new Date(Date.UTC(2026, 0, 20)),
    });
    // Anchored Jan 15 already passed → rolls to Apr 15.
    expect(next.getUTCMonth()).toBe(3); // April
    expect(next.getUTCDate()).toBe(15);
  });

  it("annual + day-15 + reference before fires this year", () => {
    const next = computeNextIssueAt({
      cadence: "annual",
      issueDayOfMonth: 15,
      reference: new Date(Date.UTC(2026, 0, 10)),
    });
    expect(next.getUTCFullYear()).toBe(2026);
    expect(next.getUTCDate()).toBe(15);
  });

  it("annual + day-15 + reference after fires next year", () => {
    const next = computeNextIssueAt({
      cadence: "annual",
      issueDayOfMonth: 15,
      reference: new Date(Date.UTC(2026, 0, 20)),
    });
    // Default month from reference is January; Jan 15 has passed → next year.
    expect(next.getUTCFullYear()).toBe(2027);
  });

  it("clamps issueDayOfMonth to [1, 28]", () => {
    const clampedHigh = computeNextIssueAt({
      cadence: "monthly",
      issueDayOfMonth: 31,
      reference: new Date(Date.UTC(2026, 0, 1)),
    });
    expect(clampedHigh.getUTCDate()).toBe(28);

    const clampedLow = computeNextIssueAt({
      cadence: "monthly",
      issueDayOfMonth: 0,
      reference: new Date(Date.UTC(2026, 0, 5)),
    });
    expect(clampedLow.getUTCDate()).toBe(1);
  });

  it("null issueDayOfMonth defaults to day 1", () => {
    const next = computeNextIssueAt({
      cadence: "monthly",
      issueDayOfMonth: null,
      reference: new Date(Date.UTC(2026, 0, 10)),
    });
    expect(next.getUTCDate()).toBe(1);
  });
});
