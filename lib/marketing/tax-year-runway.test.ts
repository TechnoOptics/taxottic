import { describe, expect, it } from "vitest";
import { taxYearRunway } from "./tax-year-runway";

/**
 * The hero's runway is a hairline ticked at the four federal estimated-tax
 * due dates and filled to a date. It is the Instrument skin's signature
 * (app/globals.css, ".runway"), and it encodes where the reader sits in
 * the tax year. These tests pin the geometry so the ticks cannot drift
 * from the statutory dates in lib/tax/constants-2026.ts.
 *
 * Span: 1 January of the tax year to the Q4 due date (15 January of the
 * following year). Positions are UTC day fractions of that span.
 */

const SAMPLE = new Date("2026-08-20T00:00:00Z");
const SPAN_DAYS = 379; // 2026-01-01 -> 2027-01-15

describe("taxYearRunway ticks", () => {
  const { ticks } = taxYearRunway(2026, SAMPLE);

  it("has the four statutory due dates in order", () => {
    expect(ticks.map((t) => t.quarter)).toEqual([1, 2, 3, 4]);
    expect(ticks.map((t) => t.date)).toEqual([
      "2026-04-15",
      "2026-06-15",
      "2026-09-15",
      "2027-01-15",
    ]);
  });

  it("labels each tick as a customer reads a deadline", () => {
    expect(ticks.map((t) => t.label)).toEqual([
      "Apr 15",
      "Jun 15",
      "Sep 15",
      "Jan 15",
    ]);
  });

  it("places Q4 at the end of the rail and Q1 at its day fraction", () => {
    expect(ticks[3].at).toBe(1);
    // 1 Jan -> 15 Apr is 104 days.
    expect(ticks[0].at).toBeCloseTo(104 / SPAN_DAYS, 6);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i].at).toBeGreaterThan(ticks[i - 1].at);
    }
  });
});

describe("taxYearRunway fill", () => {
  it("clamps to 0 before the year starts", () => {
    expect(taxYearRunway(2026, new Date("2025-12-01T00:00:00Z")).fill).toBe(0);
  });

  it("clamps to 1 after the last due date", () => {
    expect(taxYearRunway(2026, new Date("2027-03-01T00:00:00Z")).fill).toBe(1);
  });

  it("sits between Q2 and Q3 on the sample date", () => {
    const r = taxYearRunway(2026, SAMPLE);
    // 1 Jan -> 20 Aug is 231 days.
    expect(r.fill).toBeCloseTo(231 / SPAN_DAYS, 6);
    expect(r.fill).toBeGreaterThan(r.ticks[1].at);
    expect(r.fill).toBeLessThan(r.ticks[2].at);
  });
});

describe("taxYearRunway next payment", () => {
  it("is Q3 on the sample date, 26 days out", () => {
    const r = taxYearRunway(2026, SAMPLE);
    expect(r.next?.quarter).toBe(3);
    expect(r.daysToNext).toBe(26);
  });

  it("counts the due date itself as still open", () => {
    const r = taxYearRunway(2026, new Date("2026-04-15T00:00:00Z"));
    expect(r.next?.quarter).toBe(1);
    expect(r.daysToNext).toBe(0);
  });

  it("is null once Q4 has passed", () => {
    const r = taxYearRunway(2026, new Date("2027-01-16T00:00:00Z"));
    expect(r.next).toBeNull();
    expect(r.daysToNext).toBeNull();
  });
});

describe("taxYearRunway asOf label", () => {
  it("labels the sample date the way the ticks are labelled", () => {
    expect(taxYearRunway(2026, SAMPLE).asOfLabel).toBe("Aug 20");
  });
});
