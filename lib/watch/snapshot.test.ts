import { describe, it, expect } from "vitest";
import { buildWatchSnapshot, badgeTitle } from "./snapshot";

describe("badgeTitle", () => {
  it("humanizes a badge code", () => {
    expect(badgeTitle("deduction_hunter")).toBe("Deduction Hunter");
    expect(badgeTitle("first-trip")).toBe("First Trip");
  });
});

describe("buildWatchSnapshot", () => {
  it("clamps readiness 0–100 and rounds", () => {
    expect(
      buildWatchSnapshot({
        readinessScore: 142.6,
        ytdBusinessMiles: 0,
        ytdDeductionCents: 0,
        pendingTrip: null,
        latestBadgeCode: null,
      }).taxReadinessPct,
    ).toBe(100);
    expect(
      buildWatchSnapshot({
        readinessScore: -5,
        ytdBusinessMiles: 0,
        ytdDeductionCents: 0,
        pendingTrip: null,
        latestBadgeCode: null,
      }).taxReadinessPct,
    ).toBe(0);
  });

  it("derives the rough tax-saved estimate from the deduction", () => {
    const s = buildWatchSnapshot({
      readinessScore: 70,
      ytdBusinessMiles: 1000,
      ytdDeductionCents: 67_000,
      pendingTrip: null,
      latestBadgeCode: null,
    });
    expect(s.ytdDeductionCents).toBe(67_000);
    expect(s.estimatedTaxSavedCents).toBe(Math.round(67_000 * 0.22));
  });

  it("maps a pending trip + badge", () => {
    const s = buildWatchSnapshot({
      readinessScore: 50,
      ytdBusinessMiles: 0,
      ytdDeductionCents: 0,
      pendingTrip: {
        id: "trip_1",
        distanceMiles: 12.42,
        startedAtISO: "2026-05-18T14:14:00Z",
        estDeductionCents: 832,
      },
      latestBadgeCode: "road_warrior",
    });
    expect(s.pendingTrip?.id).toBe("trip_1");
    expect(s.pendingTrip?.summary.startsWith("12.4 mi")).toBe(true);
    expect(s.pendingTrip?.estDeductionCents).toBe(832);
    expect(s.latestBadge).toEqual({ title: "Road Warrior", symbol: "rosette" });
  });

  it("is empty-safe", () => {
    const s = buildWatchSnapshot({
      readinessScore: null,
      ytdBusinessMiles: 0,
      ytdDeductionCents: 0,
      pendingTrip: null,
      latestBadgeCode: null,
    });
    expect(s.taxReadinessPct).toBe(0);
    expect(s.pendingTrip).toBeUndefined();
    expect(s.latestBadge).toBeUndefined();
  });
});
