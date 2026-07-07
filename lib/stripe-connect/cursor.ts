/**
 * Pure cursor-advancement driver for the Stripe balance_transaction sync.
 *
 * Split out of lib/stripe-connect/sync.ts so the pagination logic - the part
 * that actually broke (see the sync.ts header) - is unit-testable without a
 * live Stripe account or a Supabase client. sync.ts owns the side effects
 * (row mapping, upsert, cursor persistence); this owns the WALK.
 *
 * Model: Stripe returns balance_transactions NEWEST-FIRST (descending by
 * `created`), and `starting_after` pages toward OLDER records. The stored
 * cursor is therefore a HIGH-WATER MARK - the newest id imported last run.
 * Each sync lists from the very top (newest) and walks downward until it
 * reaches that watermark, collecting everything newer, then reports the new
 * newest id as the cursor to persist.
 *
 * The previous (buggy) design stored the OLDEST id of the page and paginated
 * `starting_after` from it, marching backward through history and never seeing
 * new charges once the initial backfill reached the year start.
 */

/** Minimal shape the walk needs: an id to compare against the watermark. */
export type BalanceTxLike = { id: string };

/** Params the driver hands to `fetchPage`. `expand` is added by the caller. */
export type StripeListParams = {
  limit: number;
  starting_after?: string;
  created?: { gte?: number };
};

export type StripeCursorPlan<T extends BalanceTxLike> = {
  /**
   * Transactions strictly newer than the stored watermark, in fetch order
   * (newest-first across all pages). The caller maps + upserts these.
   */
  fresh: T[];
  /**
   * The new high-water mark to persist: the newest id seen this run, or the
   * prior watermark when the run saw nothing (so the cursor is never nulled).
   */
  newCursor: string | null;
  /** True if the stored watermark id was encountered during the walk. */
  reachedWatermark: boolean;
  /** Pages actually fetched from Stripe. */
  pagesFetched: number;
  /** Total transactions fetched across all pages. */
  fetched: number;
  /**
   * Walked the full page cap without meeting the watermark - a high-volume
   * account may have more than `pageSize * maxPages` new transactions since the
   * last sync, so this run left a gap the next sync re-covers (idempotently).
   */
  hitPageCapWithoutWatermark: boolean;
};

/**
 * Walk balance_transactions from newest toward the stored watermark.
 *
 * `fetchPage` performs the actual Stripe list call for the given params and
 * returns `{ data, has_more }` with data NEWEST-FIRST. It may throw; the driver
 * recovers ONCE from a mid-walk failure by restarting from the top (a
 * `starting_after` we sent is always an id Stripe just handed us, so it can
 * never be a stale-cursor 400 - this covers transient network/API errors).
 */
export async function planStripeCursorAdvance<T extends BalanceTxLike>(opts: {
  watermark: string | null;
  yearStartUnix: number;
  pageSize: number;
  maxPages: number;
  fetchPage: (params: StripeListParams) => Promise<{
    data: T[];
    has_more: boolean;
  }>;
}): Promise<StripeCursorPlan<T>> {
  const { watermark, yearStartUnix, pageSize, maxPages, fetchPage } = opts;

  let fresh: T[] = [];
  let newestSeen: string | null = null;
  // Pagination pointer INTO older pages. Only ever an id Stripe just handed us.
  let startingAfter: string | null = null;
  let reachedWatermark = false;
  let retriedFromTop = false;
  let pagesFetched = 0;
  let fetched = 0;

  for (let pageIdx = 0; pageIdx < maxPages; pageIdx++) {
    const params: StripeListParams = { limit: pageSize };
    if (startingAfter) {
      // Continuing the downward (into-older) walk. Never combined with
      // `created`: Stripe rejects `created` + `starting_after` for some
      // connected accounts with a 400.
      params.starting_after = startingAfter;
    } else if (!watermark) {
      // First page of the very first sync: bound to this calendar year.
      params.created = { gte: yearStartUnix };
    }
    // Incremental first page (watermark set, no startingAfter yet): send
    // neither bound, so Stripe returns from the newest transaction down.

    let page: { data: T[]; has_more: boolean };
    try {
      page = await fetchPage(params);
    } catch (err) {
      if (startingAfter && !retriedFromTop) {
        retriedFromTop = true;
        startingAfter = null;
        newestSeen = null;
        reachedWatermark = false;
        fresh = [];
        fetched = 0;
        pagesFetched = 0;
        pageIdx = -1; // loop's ++ takes the next iteration back to page 0
        continue;
      }
      throw err;
    }

    pagesFetched++;
    if (!page.data || page.data.length === 0) break;
    fetched += page.data.length;
    // The first item of the first page is the newest transaction overall.
    if (newestSeen === null) newestSeen = page.data[0].id;

    // Collect everything newer than the watermark, then stop: the id we
    // already hold (and every older one below it) is already imported.
    let stop = false;
    for (const t of page.data) {
      if (watermark && t.id === watermark) {
        reachedWatermark = true;
        stop = true;
        break;
      }
      fresh.push(t);
    }
    if (stop) break;

    startingAfter = page.data[page.data.length - 1].id;
    if (!page.has_more) break;
  }

  return {
    fresh,
    newCursor: newestSeen ?? watermark,
    reachedWatermark,
    pagesFetched,
    fetched,
    hitPageCapWithoutWatermark:
      Boolean(watermark) && !reachedWatermark && fetched >= pageSize * maxPages,
  };
}
