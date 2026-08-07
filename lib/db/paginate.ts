// Read every row a filter matches, not the first thousand.
//
// PostgREST truncates ANY response at max-rows, which is 1000 on this
// project, and it does so silently: you get 1000 rows and no error, no
// flag, nothing to distinguish "there were exactly 1000" from "there
// were 40000". The repo has been bitten by this before, on mileage trip
// polylines, where only the first few trips got a thumbnail and the
// rest silently rendered none (app/mileage/page.tsx).
//
// On an import it is worse than a display bug. summarizeImport counts
// resolved rows out of the rows it is given, so a truncated read means
// undercounting; and completeImport gates on that same count, so a
// truncated read can let an import be marked complete while unresolved
// rows sit outside the window. A silent truncation on the gate that
// protects a filed tax return is the exact shape of the counter this
// work exists to remove.
//
// Callers MUST apply a stable sort to the query they build. Without a
// total order PostgREST may return overlapping or skipped rows between
// pages, which turns one silent corruption into another.

/** PostgREST's max-rows on this project. Pages are requested at this size. */
export const PAGE_SIZE = 1000;

/**
 * A hard stop, so a bug in a caller's filter cannot spin forever. 200
 * pages is 200k rows, far past any real CSV import, and reaching it
 * means something is wrong rather than large.
 */
const MAX_PAGES = 200;

/**
 * Call `page(from, to)` until it returns a short page, and concatenate.
 *
 * The builder is a function rather than a query object because a
 * PostgREST query builder is single-use: calling .range() twice on one
 * builder mutates and re-sends the same request. Handing back a fresh
 * builder per page is the only shape that is correct, and making the
 * caller pass a function makes that impossible to get wrong.
 *
 * Errors are not swallowed: an error on any page throws, because
 * returning a partial count from here would recreate the silent
 * truncation this function exists to prevent.
 */
export async function fetchAllPages<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error?: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) {
      throw new Error(`paged read failed at offset ${from}: ${error.message}`);
    }
    const rows = data ?? [];
    out.push(...rows);
    // A short page is the only honest end-of-data signal PostgREST
    // gives. An exactly-full last page costs one extra empty request,
    // which is the correct trade against undercounting.
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}
