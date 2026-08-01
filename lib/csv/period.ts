/**
 * Human title for the period an import covers.
 *
 * The request was to title each file's review screen "with a date". A CSV
 * does not have a date, it has a range, so this formats the range the rows
 * actually cover. Where the file has no readable dates it says so rather than
 * picking one, because a made-up period on a tax document is worse than an
 * honest gap.
 *
 * All formatting is in UTC. `posted_at` is a Postgres `date` with no zone,
 * and rendering it in the viewer's local zone slides a January 1 charge into
 * December, moving it to a different tax year on screen.
 */

const MONTH_DAY: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
};

function at(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

function fmt(iso: string, opts: Intl.DateTimeFormatOptions): string {
  return at(iso).toLocaleDateString("en-US", opts);
}

/**
 * Examples:
 *   same day        "Mar 4, 2026"
 *   within a month  "Mar 1 to Mar 31, 2026"
 *   across months   "Jan 12 to Mar 4, 2026"
 *   across years    "Dec 12, 2025 to Jan 4, 2026"
 *   no dates        null
 */
export function formatImportPeriod(
  periodStart: string | null | undefined,
  periodEnd: string | null | undefined,
): string | null {
  if (!periodStart || !periodEnd) return null;

  const startYear = periodStart.slice(0, 4);
  const endYear = periodEnd.slice(0, 4);

  if (periodStart.slice(0, 10) === periodEnd.slice(0, 10)) {
    return fmt(periodStart, { ...MONTH_DAY, year: "numeric" });
  }
  if (startYear !== endYear) {
    return `${fmt(periodStart, { ...MONTH_DAY, year: "numeric" })} to ${fmt(
      periodEnd,
      { ...MONTH_DAY, year: "numeric" },
    )}`;
  }
  return `${fmt(periodStart, MONTH_DAY)} to ${fmt(periodEnd, {
    ...MONTH_DAY,
    year: "numeric",
  })}`;
}
