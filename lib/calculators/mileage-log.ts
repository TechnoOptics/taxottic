import { mileageRateCentsForDate } from "@/lib/mileage/deduction";

/**
 * Build an IRS-shaped mileage log from trips a user types in.
 *
 * The rate is NOT the hard part of a mileage deduction. Substantiation
 * is. IRS Publication 463 wants a record made at or near the time of the
 * trip showing the date, the business purpose, and the mileage, and a
 * total reconstructed in April from a fuel card is exactly what gets
 * disallowed. This module turns entered trips into that record and
 * prices each one at the rate in force ON ITS OWN DATE, which matters in
 * a split-rate year like 2026.
 *
 * It deliberately does not invent anything. No trip is generated, no
 * mileage is estimated, no purpose is guessed. A log that fabricates
 * entries is worse than no log: it is a false record of a tax position.
 * Everything here is a formatter and a checker over what the user
 * supplied.
 */

export type LogTrip = {
  /** ISO yyyy-mm-dd. */
  date: string;
  /** Business purpose. Required by Pub 463; a log without it is weak. */
  purpose: string;
  from: string;
  to: string;
  miles: number;
};

export type LogRow = LogTrip & {
  centsPerMile: number;
  deductionCents: number;
  /** Problems that would weaken this row if the log were questioned. */
  issues: string[];
};

export type LogSummary = {
  rows: LogRow[];
  totalMiles: number;
  totalDeductionCents: number;
  /** Rows carrying at least one issue. */
  incompleteCount: number;
  taxYear: number;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Purposes that say nothing. Pub 463 asks for a BUSINESS PURPOSE, and
 * "work" restates that the trip was for work without identifying it.
 * Flagged rather than rejected: it is the user's log, and the point is
 * to tell them where it is thin before the IRS does.
 */
const VAGUE_PURPOSES = new Set([
  "work",
  "business",
  "errand",
  "errands",
  "misc",
  "miscellaneous",
  "trip",
  "driving",
  "n/a",
  "-",
]);

export function buildMileageLog(
  trips: LogTrip[],
  taxYear: number,
): LogSummary {
  const rows: LogRow[] = trips.map((t) => {
    const issues: string[] = [];

    if (!ISO_DATE.test(t.date)) {
      issues.push("Missing or unreadable date");
    } else if (Number(t.date.slice(0, 4)) !== taxYear) {
      issues.push(`Date is not in ${taxYear}`);
    }

    const purpose = t.purpose.trim();
    if (!purpose) issues.push("No business purpose recorded");
    else if (VAGUE_PURPOSES.has(purpose.toLowerCase()))
      issues.push("Business purpose is too vague to substantiate");

    if (!(t.miles > 0)) issues.push("Miles must be greater than zero");
    if (!t.from.trim() || !t.to.trim())
      issues.push("Start or end point missing");

    const centsPerMile = ISO_DATE.test(t.date)
      ? mileageRateCentsForDate(taxYear, t.date)
      : mileageRateCentsForDate(taxYear);
    const miles = t.miles > 0 ? t.miles : 0;

    return {
      ...t,
      centsPerMile,
      // Rounded per trip, because a log is read line by line and the
      // lines have to add up to the total printed underneath them.
      deductionCents: Math.round(miles * centsPerMile),
      issues,
    };
  });

  return {
    rows,
    totalMiles: rows.reduce((s, r) => s + (r.miles > 0 ? r.miles : 0), 0),
    totalDeductionCents: rows.reduce((s, r) => s + r.deductionCents, 0),
    incompleteCount: rows.filter((r) => r.issues.length > 0).length,
    taxYear,
  };
}

/** RFC 4180 escaping. Commas and quotes in a purpose must not shift columns. */
function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function mileageLogToCsv(summary: LogSummary): string {
  const header = [
    "Date",
    "Business purpose",
    "From",
    "To",
    "Miles",
    "Rate (cents/mile)",
    "Deduction (USD)",
  ];
  const lines = [header.map(csvCell).join(",")];

  for (const r of summary.rows) {
    lines.push(
      [
        r.date,
        r.purpose,
        r.from,
        r.to,
        r.miles,
        r.centsPerMile,
        (r.deductionCents / 100).toFixed(2),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  lines.push(
    [
      "TOTAL",
      `${summary.rows.length} trips, tax year ${summary.taxYear}`,
      "",
      "",
      summary.totalMiles,
      "",
      (summary.totalDeductionCents / 100).toFixed(2),
    ]
      .map(csvCell)
      .join(","),
  );

  // Trailing newline: some spreadsheet importers drop the last row without
  // it, which would silently lose the TOTAL line.
  return lines.join("\r\n") + "\r\n";
}
