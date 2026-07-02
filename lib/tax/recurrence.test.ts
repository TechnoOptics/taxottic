import { describe, it, expect } from "vitest";
import {
  expandRowToMonthly,
  combineMonthly,
  ytdOfMonthly,
  totalOfMonthly,
  type RecurringRow,
} from "./recurrence";

describe("expandRowToMonthly", () => {
  it("one_off contributes only in its own month", () => {
    const out = expandRowToMonthly({ month: 4, amount_cents: 1000, recurrence: "one_off" });
    expect(out).toEqual([0, 0, 0, 1000, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("monthly projects from its start month through December", () => {
    const out = expandRowToMonthly({ month: 10, amount_cents: 500, recurrence: "monthly" });
    expect(out).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 500, 500, 500]);
  });

  it("quarterly repeats every 3 months from its start", () => {
    const out = expandRowToMonthly({ month: 2, amount_cents: 300, recurrence: "quarterly" });
    // months 2, 5, 8, 11 (1-indexed) → indices 1,4,7,10
    expect(out).toEqual([0, 300, 0, 0, 300, 0, 0, 300, 0, 0, 300, 0]);
  });

  it("annual contributes once, in its start month only", () => {
    const out = expandRowToMonthly({ month: 6, amount_cents: 9999, recurrence: "annual" });
    expect(out).toEqual([0, 0, 0, 0, 0, 9999, 0, 0, 0, 0, 0, 0]);
  });

  describe("recurrence_end_month", () => {
    it("caps a monthly projection at the end month, inclusive", () => {
      const out = expandRowToMonthly({
        month: 3,
        amount_cents: 100,
        recurrence: "monthly",
        recurrence_end_month: 6,
      });
      // Months 3-6 get the charge; 7-12 are zeroed (cancelled after June).
      expect(out).toEqual([0, 0, 100, 100, 100, 100, 0, 0, 0, 0, 0, 0]);
    });

    it("capping at the row's own start month keeps just that one occurrence", () => {
      // This is exactly what the auto-detector writes when a stream is
      // found stopped: recurrence_end_month === the anchor's own month.
      const out = expandRowToMonthly({
        month: 5,
        amount_cents: 250,
        recurrence: "monthly",
        recurrence_end_month: 5,
      });
      expect(out).toEqual([0, 0, 0, 0, 250, 0, 0, 0, 0, 0, 0, 0]);
    });

    it("caps a quarterly projection, dropping later quarters", () => {
      const out = expandRowToMonthly({
        month: 1,
        amount_cents: 1000,
        recurrence: "quarterly",
        recurrence_end_month: 7,
      });
      // Uncapped this would be months 1,4,7,10; cap at 7 drops month 10.
      expect(out).toEqual([1000, 0, 0, 1000, 0, 0, 1000, 0, 0, 0, 0, 0]);
    });

    it("null/undefined recurrence_end_month behaves exactly like before (through December)", () => {
      const withNull = expandRowToMonthly({
        month: 8,
        amount_cents: 400,
        recurrence: "monthly",
        recurrence_end_month: null,
      });
      const withUndefined = expandRowToMonthly({
        month: 8,
        amount_cents: 400,
        recurrence: "monthly",
      });
      expect(withNull).toEqual(withUndefined);
      expect(withNull).toEqual([0, 0, 0, 0, 0, 0, 0, 400, 400, 400, 400, 400]);
    });

    it("never zeroes a row's own month even if recurrence_end_month is nonsensically earlier", () => {
      // Shouldn't happen from real callers, but the cap is floored at
      // the row's own start month defensively — bad/stale data must
      // never erase a row's real occurrence.
      const oneOff = expandRowToMonthly({
        month: 3,
        amount_cents: 700,
        recurrence: "one_off",
        recurrence_end_month: 1,
      });
      expect(oneOff).toEqual([0, 0, 700, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    });
  });
});

describe("combineMonthly / ytdOfMonthly / totalOfMonthly with a stopped stream", () => {
  it("a stopped monthly expense's YTD and full-year totals both reflect the cap", () => {
    const rows: RecurringRow[] = [
      { month: 2, amount_cents: 9000, recurrence: "monthly", recurrence_end_month: 4 },
    ];
    const monthly = combineMonthly(rows.map(expandRowToMonthly));
    // Feb, Mar, Apr only = 3 × 9000 = 27000; nothing after.
    expect(totalOfMonthly(monthly)).toBe(27_000);
    // As of June, YTD should be the same — the stream already ended.
    expect(ytdOfMonthly(monthly, 6)).toBe(27_000);
    // As of March (before the row's own end), YTD is just Feb+Mar.
    expect(ytdOfMonthly(monthly, 3)).toBe(18_000);
  });
});
