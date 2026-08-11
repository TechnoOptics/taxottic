import { describe, expect, it } from "vitest";
import {
  buildMileageLog,
  mileageLogToCsv,
  type LogTrip,
} from "./mileage-log";

/**
 * Two things must hold, and they pull in different directions.
 *
 * ACCURACY: each trip is priced at the rate in force on its own date.
 * 2026 is a split-rate year, so a log spanning July prices differently
 * either side of it, and getting that wrong is the same bug the public
 * mileage calculator shipped with.
 *
 * HONESTY: this tool must never invent a trip, a mileage figure or a
 * business purpose. A log that fills in gaps is a false record of a tax
 * position, which is materially worse than an incomplete one. So the
 * tests below check that thin rows are FLAGGED and left alone rather
 * than repaired.
 */

const YEAR = 2026;

const trip = (over: Partial<LogTrip> = {}): LogTrip => ({
  date: "2026-03-14",
  purpose: "Client site visit, Acme Corp quarterly review",
  from: "Office",
  to: "Acme Corp, Bloomington",
  miles: 18.4,
  ...over,
});

describe("pricing follows the trip date", () => {
  it("prices a first-half trip at the first-half rate", () => {
    const s = buildMileageLog([trip({ date: "2026-06-30", miles: 100 })], YEAR);
    expect(s.rows[0].centsPerMile).toBe(72.5);
    expect(s.rows[0].deductionCents).toBe(7_250);
  });

  it("prices a second-half trip at the higher rate", () => {
    const s = buildMileageLog([trip({ date: "2026-07-01", miles: 100 })], YEAR);
    expect(s.rows[0].centsPerMile).toBe(76);
    expect(s.rows[0].deductionCents).toBe(7_600);
  });

  it("prices a log that straddles the split correctly", () => {
    const s = buildMileageLog(
      [
        trip({ date: "2026-02-10", miles: 200 }),
        trip({ date: "2026-09-10", miles: 200 }),
      ],
      YEAR,
    );
    // 200 x 72.5 = 14,500 ; 200 x 76 = 15,200
    expect(s.totalDeductionCents).toBe(29_700);
    // A single flat rate over 400 miles would be 29,000.
    expect(s.totalDeductionCents).not.toBe(29_000);
  });

  it("line items sum to the printed total", () => {
    // A log is read line by line. If the rows do not add up to the
    // total underneath them, the document undermines itself.
    const s = buildMileageLog(
      [
        trip({ date: "2026-01-05", miles: 33.3 }),
        trip({ date: "2026-08-05", miles: 71.7 }),
        trip({ date: "2026-11-20", miles: 12.9 }),
      ],
      YEAR,
    );
    const summed = s.rows.reduce((a, r) => a + r.deductionCents, 0);
    expect(summed).toBe(s.totalDeductionCents);
  });
});

describe("it flags weak rows and never repairs them", () => {
  it("flags a missing business purpose", () => {
    const s = buildMileageLog([trip({ purpose: "" })], YEAR);
    expect(s.rows[0].issues).toContain("No business purpose recorded");
    expect(s.incompleteCount).toBe(1);
  });

  it("flags a purpose that restates nothing", () => {
    // Pub 463 asks what the trip was FOR. "work" is not that.
    for (const p of ["work", "Business", "  errands  ", "misc"]) {
      const s = buildMileageLog([trip({ purpose: p })], YEAR);
      expect(
        s.rows[0].issues.some((i) => i.includes("too vague")),
        `expected "${p}" to be flagged as vague`,
      ).toBe(true);
    }
  });

  it("accepts a real purpose without complaint", () => {
    expect(buildMileageLog([trip()], YEAR).rows[0].issues).toEqual([]);
  });

  it("flags a date outside the tax year rather than moving it", () => {
    const s = buildMileageLog([trip({ date: "2025-12-31" })], YEAR);
    expect(s.rows[0].issues).toContain("Date is not in 2026");
    expect(s.rows[0].date).toBe("2025-12-31");
  });

  it("flags zero or negative miles and contributes nothing", () => {
    const s = buildMileageLog([trip({ miles: 0 }), trip({ miles: -5 })], YEAR);
    expect(s.incompleteCount).toBe(2);
    expect(s.totalMiles).toBe(0);
    expect(s.totalDeductionCents).toBe(0);
  });

  it("never fabricates a value for a flagged row", () => {
    const s = buildMileageLog(
      [{ date: "", purpose: "", from: "", to: "", miles: 0 }],
      YEAR,
    );
    const r = s.rows[0];
    expect(r.purpose).toBe("");
    expect(r.from).toBe("");
    expect(r.miles).toBe(0);
    expect(r.deductionCents).toBe(0);
    expect(r.issues.length).toBeGreaterThan(2);
  });
});

describe("CSV export", () => {
  it("escapes commas and quotes so columns cannot shift", () => {
    // A purpose is free text and will contain commas. Unescaped, the
    // deduction column silently lands under the wrong header.
    const csv = mileageLogToCsv(
      buildMileageLog(
        [trip({ purpose: 'Lunch with "Acme", then site visit' })],
        YEAR,
      ),
    );
    expect(csv).toContain('"Lunch with ""Acme"", then site visit"');
    const dataLine = csv.split("\r\n")[1];
    // 7 columns: the quoted field must not split into extra ones.
    const cols = dataLine.match(/(".*?"|[^,]*)(,|$)/g)!.filter(Boolean);
    expect(cols.length).toBeGreaterThanOrEqual(7);
  });

  it("carries a TOTAL row that matches the summary", () => {
    const s = buildMileageLog(
      [trip({ miles: 100, date: "2026-02-01" }), trip({ miles: 50, date: "2026-08-01" })],
      YEAR,
    );
    const csv = mileageLogToCsv(s);
    const total = csv.trim().split("\r\n").pop()!;
    expect(total.startsWith("TOTAL")).toBe(true);
    expect(total).toContain("150");
    expect(total).toContain((s.totalDeductionCents / 100).toFixed(2));
  });

  it("ends with a newline so importers keep the last row", () => {
    const csv = mileageLogToCsv(buildMileageLog([trip()], YEAR));
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("has a header naming every column Pub 463 expects", () => {
    const header = mileageLogToCsv(buildMileageLog([], YEAR)).split("\r\n")[0];
    for (const c of ["Date", "Business purpose", "Miles"]) {
      expect(header).toContain(c);
    }
  });

  it("handles an empty log without producing a broken file", () => {
    const csv = mileageLogToCsv(buildMileageLog([], YEAR));
    const lines = csv.trim().split("\r\n");
    expect(lines).toHaveLength(2); // header + TOTAL
    expect(lines[1]).toContain("0 trips");
  });
});
