import { QUARTERLY_DUE_DATES_2025 } from "@/lib/tax/constants-2025";
import { QUARTERLY_DUE_DATES_2026 } from "@/lib/tax/constants-2026";

/**
 * Geometry for the tax-year runway: a hairline ticked at the four federal
 * estimated-tax due dates and filled to a date. It encodes where the
 * reader sits in the tax year, which is the one fact this product exists
 * to keep in front of them. Pure and UTC so the marketing hero can render
 * it from a fixed sample date and the visual baselines stay still.
 *
 * Span: 1 January of the tax year to the Q4 due date (15 January of the
 * following year). Positions are day fractions of that span.
 */

export type RunwayTick = {
  quarter: 1 | 2 | 3 | 4;
  /** ISO date, e.g. "2026-09-15". */
  date: string;
  /** How a customer reads a deadline, e.g. "Sep 15". */
  label: string;
  /** Position along the rail, 0..1. */
  at: number;
};

export type TaxYearRunway = {
  ticks: RunwayTick[];
  /** Filled portion of the rail, 0..1, clamped. */
  fill: number;
  /** The first due date on or after `asOf`, or null once Q4 has passed. */
  next: RunwayTick | null;
  daysToNext: number | null;
  /** `asOf`, labelled the same way as the ticks, e.g. "Aug 20". */
  asOfLabel: string;
  /** Days into the tax year, 1-based from 1 January; 0 before it starts. */
  dayOfYear: number;
};

const DUE_DATES = {
  2025: QUARTERLY_DUE_DATES_2025,
  2026: QUARTERLY_DUE_DATES_2026,
} as const;

const DAY_MS = 86_400_000;
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function taxYearRunway(taxYear: number, asOf: Date): TaxYearRunway {
  const dueDates = DUE_DATES[taxYear as keyof typeof DUE_DATES];
  if (!dueDates) throw new Error(`no quarterly due dates for tax year ${taxYear}`);

  const start = Date.UTC(taxYear, 0, 1);
  const dueMs = dueDates.map((d) =>
    Date.UTC(d.inFollowingYear ? taxYear + 1 : taxYear, d.month - 1, d.day),
  );
  const end = dueMs[dueMs.length - 1];
  const span = end - start;

  const ticks: RunwayTick[] = dueDates.map((d, i) => ({
    quarter: d.quarter,
    date: new Date(dueMs[i]).toISOString().slice(0, 10),
    label: `${MONTH[d.month - 1]} ${d.day}`,
    at: (dueMs[i] - start) / span,
  }));

  const now = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const fill = Math.min(1, Math.max(0, (now - start) / span));

  const nextIndex = dueMs.findIndex((ms) => ms >= now);
  const next = nextIndex === -1 ? null : ticks[nextIndex];
  const daysToNext =
    nextIndex === -1 ? null : Math.round((dueMs[nextIndex] - now) / DAY_MS);

  const asOfLabel = `${MONTH[asOf.getUTCMonth()]} ${asOf.getUTCDate()}`;

  const dayOfYear = Math.max(0, Math.min(Math.round((now - start) / DAY_MS) + 1, Math.round(span / DAY_MS) + 1));

  return { ticks, fill, next, daysToNext, asOfLabel, dayOfYear };
}

/**
 * Position of an ISO date (YYYY-MM-DD) along the rail, 0..1, clamped.
 * Same span as the ticks so a section anchored to a date and the tick
 * for a due date agree to the pixel.
 */
export function fractionOf(taxYear: number, isoDate: string): number {
  const dueDates = DUE_DATES[taxYear as keyof typeof DUE_DATES];
  if (!dueDates) throw new Error(`no quarterly due dates for tax year ${taxYear}`);
  const start = Date.UTC(taxYear, 0, 1);
  const last = dueDates[dueDates.length - 1];
  const end = Date.UTC(last.inFollowingYear ? taxYear + 1 : taxYear, last.month - 1, last.day);
  const [y, m, d] = isoDate.split("-").map(Number);
  const at = Date.UTC(y, m - 1, d);
  return Math.min(1, Math.max(0, (at - start) / (end - start)));
}
