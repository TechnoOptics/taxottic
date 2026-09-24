/**
 * How a changelog entry is rendered as a ledger row: its date in the
 * data face, and the anchor that makes the row addressable.
 *
 * These live here rather than inside app/changelog/page.tsx because
 * both are pure and both have a way of being silently wrong. A date
 * formatted in the visitor's local zone slips a day for anyone west of
 * UTC (the entry dated the 1st renders as the 31st of the month
 * before), and an id that is not stable breaks every /changelog#... link
 * ever shared. changelog-format.test.ts pins both.
 */

/** The shape a row needs. `Entry` on the page is a superset. */
export type ChangelogEntryRef = { date: string; title: string };

/**
 * `2026-08-06` as `Aug 6, 2026`. Parsed and formatted in UTC: the
 * dates are calendar dates, not instants, so the reader's zone must not
 * move them.
 */
export function formatEntryDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${date}T00:00:00Z`));
}

/**
 * The row's anchor: the entry's date and a slug of its title. The date
 * alone is not unique (two entries share 2026-08-06) and the index is
 * not usable, because new entries go at the top and would renumber
 * every anchor on every release. Stable for as long as the entry's date
 * and title are.
 */
export function entryId(e: ChangelogEntryRef): string {
  const slug = e.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${e.date}-${slug}`;
}
