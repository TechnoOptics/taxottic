/**
 * Helpers for expanding income / expense rows that carry a `recurrence`
 * cadence into per-month dollar contributions.
 *
 * Mental model:
 *   - one_off       : the row is a single sample at its given month.
 *   - weekly        : repeats ~4.345 times per month from start month
 *                     onward (4.333 = 52/12, but we use the full ISO
 *                     average so a weekly $100 gets credited as ~$433/mo).
 *   - monthly       : repeats once per month from start month onward.
 *   - quarterly     : repeats once at the start month and every 3 months
 *                     after, until the year ends.
 *   - annual        : repeats once at the start month, year over year, so
 *                     within a single tax year it counts as a single
 *                     payment in the start month (the "year" boundary
 *                     means you pay the next iteration NEXT year).
 *
 * Both income and expense rows share the same shape, so this helper is
 * generic over the row type via duck-typing on { month, amount_cents,
 * recurrence }.
 */

export type Recurrence =
  | "one_off"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual";

export type RecurringRow = {
  month: number;             // 1-12 (1 = January)
  amount_cents: number;
  recurrence: Recurrence | null;
};

// Roughly 52 weeks / 12 months. Used to convert a weekly rate to a
// monthly contribution. Imperfect (some months have 4 weeks, some 5) but
// for forecast purposes the year-total matches.
const WEEKS_PER_MONTH = 52 / 12;

/**
 * Returns a 12-element array (index 0 = January, 11 = December) of the
 * dollar contribution from this single row. Sum the array to get the
 * row's annual contribution. Slice to current_month to get YTD.
 */
export function expandRowToMonthly(row: RecurringRow): number[] {
  const out = new Array(12).fill(0) as number[];
  const startIdx = clamp(row.month, 1, 12) - 1;
  const recur = (row.recurrence ?? "one_off") as Recurrence;

  switch (recur) {
    case "one_off": {
      out[startIdx] += row.amount_cents;
      break;
    }
    case "monthly": {
      for (let i = startIdx; i < 12; i++) out[i] += row.amount_cents;
      break;
    }
    case "quarterly": {
      for (let i = startIdx; i < 12; i += 3) out[i] += row.amount_cents;
      break;
    }
    case "annual": {
      // Once per calendar year. We've already established the start
      // month; the next iteration falls in NEXT tax year, so within
      // this year there's just one contribution.
      out[startIdx] += row.amount_cents;
      break;
    }
    case "weekly": {
      // Spread the per-week amount across remaining months.
      // We round per month so the grand total stays close to:
      //   amount_cents × (weeks remaining in the year from start week)
      // Approximation: from start month through December, allocate
      // (4 + frac) weeks per month, where frac balances out across the
      // span so the total = amount × (12 - startIdx) × WEEKS_PER_MONTH.
      let accumulated = 0;
      const weeksPerMonth = WEEKS_PER_MONTH;
      for (let i = startIdx; i < 12; i++) {
        // exact running total of weeks completed by end of this month
        const exactCumWeeks = (i - startIdx + 1) * weeksPerMonth;
        const exactCents = row.amount_cents * exactCumWeeks;
        const monthCents = Math.round(exactCents) - accumulated;
        out[i] += monthCents;
        accumulated += monthCents;
      }
      break;
    }
  }

  return out;
}

/**
 * Sum a list of monthly contribution arrays into a single 12-month
 * series.
 */
export function combineMonthly(series: number[][]): number[] {
  const out = new Array(12).fill(0) as number[];
  for (const s of series) {
    for (let i = 0; i < 12; i++) out[i] += s[i] ?? 0;
  }
  return out;
}

/**
 * Year-to-date sum of a monthly series (months 1..currentMonth, inclusive).
 */
export function ytdOfMonthly(monthly: number[], currentMonth: number): number {
  let total = 0;
  const upTo = clamp(currentMonth, 1, 12);
  for (let i = 0; i < upTo; i++) total += monthly[i] ?? 0;
  return total;
}

/**
 * Full-year sum of a monthly series.
 */
export function totalOfMonthly(monthly: number[]): number {
  let total = 0;
  for (let i = 0; i < 12; i++) total += monthly[i] ?? 0;
  return total;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
