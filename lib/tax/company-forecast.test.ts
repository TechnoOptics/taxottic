import { describe, it, expect } from "vitest";
import {
  buildCompanyForecast,
  type CompanyForecastArgs,
  type ForecastTaxProfile,
} from "./company-forecast";

const taxProfile: ForecastTaxProfile = {
  filing_status: "single",
  state_code: "TX",
  age: 35,
  is_blind: false,
  itemize: false,
  dependents: 0,
};

function args(over: Partial<CompanyForecastArgs> = {}): CompanyForecastArgs {
  return {
    taxYear: 2026,
    currentMonth: 6,
    company: { state_code: "TX", entity_type: "sole_prop" },
    taxProfile,
    businessProfile: null,
    incomes: [],
    expenses: [],
    trackedYtdMileageCents: 0,
    trackedTripCount: 0,
    ...over,
  };
}

describe("buildCompanyForecast", () => {
  it("is empty-safe and returns both scenarios + the summary", () => {
    const f = buildCompanyForecast(args());
    expect(f.ytdResult).toBeDefined();
    expect(f.result).toBeDefined();
    expect(f.summary.entityType).toBe("sole_prop");
    expect(f.summary.monthsEntered).toBeGreaterThanOrEqual(1);
    expect(f.result.totalTaxCents).toBeGreaterThanOrEqual(0);
    // No income → no tax owed.
    expect(f.result.stillOwedCents).toBe(0);
  });

  it("is deterministic (same inputs → identical forecast)", () => {
    const a = buildCompanyForecast(args());
    const b = buildCompanyForecast(args());
    expect(a.result).toEqual(b.result);
    expect(a.ytdResult).toEqual(b.ytdResult);
  });

  it("more business income → more total tax; expenses reduce it", () => {
    const lowIncome = buildCompanyForecast(
      args({
        incomes: [{ amount_cents: 2_000_00, month: 1, recurrence: "monthly" }],
      }),
    ).result.totalTaxCents;
    const highIncome = buildCompanyForecast(
      args({
        incomes: [{ amount_cents: 8_000_00, month: 1, recurrence: "monthly" }],
      }),
    ).result.totalTaxCents;
    expect(highIncome).toBeGreaterThan(lowIncome);

    const withExpenses = buildCompanyForecast(
      args({
        incomes: [{ amount_cents: 8_000_00, month: 1, recurrence: "monthly" }],
        expenses: [
          {
            amount_cents: 3_000_00,
            month: 1,
            recurrence: "monthly",
            category_code: "supplies",
          },
        ],
      }),
    ).result.totalTaxCents;
    expect(withExpenses).toBeLessThan(highIncome);
  });

  it("splits one-off (counted once) from recurring (expanded)", () => {
    const f = buildCompanyForecast(
      args({
        incomes: [
          { amount_cents: 1_000_00, month: 3, recurrence: "one_off" },
          { amount_cents: 500_00, month: 1, recurrence: "monthly" },
        ],
      }),
    );
    expect(f.oneOffIncomes).toHaveLength(1);
    expect(f.recurringIncomeMonthly.some((c) => c > 0)).toBe(true);
    expect(f.monthsWithOneOff).toBe(1);
  });
});
