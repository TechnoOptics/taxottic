import { describe, it, expect } from "vitest";
import { buildWatchSnapshot, badgeTitle, type SnapshotInput } from "./snapshot";

const base: SnapshotInput = {
  readinessScore: 70,
  ytdDeductionCents: 0,
  todayBusinessMiles: 0,
  todayDeductionCents: 0,
  pendingTrips: [],
  pendingExpenses: [],
  goals: [],
  outstandingCount: 0,
  deductions: [],
  forecast: undefined,
  latestBadgeCode: null,
  newBadgeCode: null,
  companyId: null,
  reward: null,
};

describe("badgeTitle", () => {
  it("humanizes a badge code", () => {
    expect(badgeTitle("deduction_hunter")).toBe("Deduction Hunter");
    expect(badgeTitle("first-trip")).toBe("First Trip");
  });
});

describe("buildWatchSnapshot", () => {
  it("clamps readiness 0–100", () => {
    expect(
      buildWatchSnapshot({ ...base, readinessScore: 142 }).taxReadinessPct,
    ).toBe(100);
    expect(
      buildWatchSnapshot({ ...base, readinessScore: -3 }).taxReadinessPct,
    ).toBe(0);
  });

  it("derives the rough tax-saved estimate", () => {
    const s = buildWatchSnapshot({ ...base, ytdDeductionCents: 67_000 });
    expect(s.estimatedTaxSavedCents).toBe(Math.round(67_000 * 0.22));
  });

  it("builds a swipe deck from trips + expenses", () => {
    const s = buildWatchSnapshot({
      ...base,
      pendingTrips: [
        {
          id: "t1",
          distanceMiles: 12.42,
          startedAtISO: "2026-05-18T14:14:00Z",
          estDeductionCents: 832,
        },
      ],
      pendingExpenses: [
        {
          id: "e1",
          kind: "expense",
          label: "Lunch · Sweetgreen",
          note: "needs a category",
          amountCents: 1840,
        },
      ],
    });
    expect(s.confirmations).toHaveLength(2);
    expect(s.confirmations[0]).toMatchObject({
      kind: "trip",
      leftLabel: "Business",
      rightLabel: "Personal",
    });
    expect(s.confirmations[0].title.startsWith("Drive · 12.4 mi")).toBe(true);
    expect(s.confirmations[1]).toMatchObject({
      kind: "expense",
      leftLabel: "Business",
      rightLabel: "Personal",
    });
  });

  it("maps goals, deductions, today mileage, forecast, badges", () => {
    const s = buildWatchSnapshot({
      ...base,
      todayBusinessMiles: 8.2,
      todayDeductionCents: 549,
      goals: [{ id: "g1", title: "Roth", savedCents: 250000, targetCents: 700000 }],
      deductions: [{ name: "Home office", amountCents: 150000, captured: false }],
      forecast: {
        label: "2026 federal estimate",
        netCents: 412300,
        effectiveRatePct: 18,
        ytdIncomeCents: 5_200_000,
      },
      latestBadgeCode: "road_warrior",
      newBadgeCode: "road_warrior",
    });
    expect(s.goals[0]).toEqual({
      id: "g1",
      title: "Roth",
      savedCents: 250000,
      targetCents: 700000,
    });
    expect(s.deductions[0].name).toBe("Home office");
    expect(s.mileage.todayDeductionCents).toBe(549);
    expect(s.forecast?.netCents).toBe(412300);
    expect(s.latestBadge).toEqual({ title: "Road Warrior", symbol: "rosette" });
    expect(s.newBadgeCode).toBe("road_warrior");
  });

  it("is empty-safe", () => {
    const s = buildWatchSnapshot({ ...base, readinessScore: null });
    expect(s.taxReadinessPct).toBe(0);
    expect(s.confirmations).toEqual([]);
    expect(s.goals).toEqual([]);
    expect(s.mileage.trackingActive).toBe(false);
    expect(s.outstandingCount).toBe(0);
  });

  it("carries the TRUE outstanding count, independent of the capped swipe deck", () => {
    // The swipe deck (confirmations) only ships a couple of preview
    // cards, but outstandingCount must reflect the real total so a
    // watch complication never undercounts.
    const s = buildWatchSnapshot({
      ...base,
      pendingTrips: [
        { id: "t1", distanceMiles: 3, startedAtISO: "2026-05-18T14:14:00Z", estDeductionCents: 200 },
      ],
      outstandingCount: 14,
    });
    expect(s.confirmations).toHaveLength(1);
    expect(s.outstandingCount).toBe(14);
  });
});
