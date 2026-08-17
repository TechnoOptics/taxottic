/**
 * How far back the RENDER-PATH freshness pass looks.
 *
 * ## Why this is hours and not days
 *
 * finalize's first act is to page the whole unconsumed staging pool for
 * its window out of PostgREST, 1000 rows per HTTP round trip. Raw points
 * that never become a trip (parked, sub-threshold, GPS noise) are never
 * marked consumed, because consumption is keyed to a formed trip's time
 * range. That residue therefore never shrinks, and a wide window re-reads
 * all of it on every single page load. Measured against the owner's live
 * account in August 2026: a 7-day window pulled 6,743 rows over 7
 * sequential HTTP pages and cost 1.1-1.5s of blocking render time, while
 * producing nothing, because every one of those points had already been
 * offered to finalize dozens of times and rejected.
 *
 * The render path is the third line of defence, not the first. Two paths
 * already cover this data far more thoroughly:
 *
 *   - `/api/mileage/ingest` finalizes a 24-hour window on EVERY upload
 *     from the device, so a drive is normally materialised while it is
 *     still being driven.
 *   - the `mileage-finalize` cron finalizes a 45-DAY window every 10
 *     minutes for every driver with a pool (see vercel.json).
 *
 * So the only gap a render can close is a drive that landed since the
 * last cron tick and that ingest did not close. Six hours is 36 cron
 * ticks of slack for that, which absorbs a lengthy cron outage and still
 * fits the common case in a single HTTP page (27 rows on the same live
 * account, versus 6,743). Widening this back to days buys no coverage the
 * cron does not already provide, and charges every reader for it.
 *
 * The ordering invariant (render < ingest < cron) is pinned by
 * finalize-freshness.test.ts against the real windows in those two
 * routes, so narrowing the cron or widening this fails the suite.
 */
export const RENDER_FRESHNESS_WINDOW_MS = 6 * 60 * 60_000;

/**
 * Did the freshness pass finish before the page had to render?
 *
 * ## The failure this exists to end
 *
 * /mileage materialises the viewer's staged GPS points at render time so a
 * drive that just ended is on screen without waiting out the 10-minute
 * cron. That work is time-boxed, because a huge staging pool must not hold
 * the page hostage.
 *
 * The old shape was `Promise.race([finalize, sleep(2500)])`. Promise.race
 * does not cancel the loser. When finalize took longer than the budget the
 * page rendered WITHOUT the new drive, finalize completed a moment later,
 * and the drive appeared only on the NEXT render. The reported symptom was
 * exactly that: load the page and nothing new is there, tap any control,
 * and the drive appears. That tap was showing them the PREVIOUS load's
 * finalize result.
 *
 * ## Why not just raise the budget
 *
 * Because that trades a stale list for a slow page, and it does not
 * actually close the hole, it only moves it to whatever the next slow run
 * costs. The honest fix is to keep the fast render and REPORT that the run
 * was still outstanding, so the client can wait for that one run and
 * refresh exactly once. When the run finished inside the budget the page
 * is already correct and the client must do nothing, otherwise every page
 * load pays for a second render it did not need.
 *
 * ## Why a failed run counts as "finished"
 *
 * A run that threw has nothing outstanding: no write is still coming, so
 * asking the client to wait for it and refresh would buy a second render
 * for nothing. Both arms of the `.then` below therefore report the same
 * thing, and this function never rejects, so a broken freshness pass
 * degrades to "render what we already have" rather than to an error page
 * for somebody who only opened their drive log.
 */
export async function settleWithinBudget(
  work: Promise<unknown>,
  budgetMs: number,
): Promise<{ finished: boolean }> {
  // Attached BEFORE the race, so a late failure can never surface as an
  // unhandled rejection after this function has already returned.
  const guarded = work.then(
    () => true,
    () => true,
  );

  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), budgetMs);
  });

  try {
    const finished = await Promise.race([guarded, budget]);
    return { finished };
  } finally {
    // Cleared rather than left to fire: a stray timer keeps a serverless
    // invocation's event loop busy for no reason.
    if (timer) clearTimeout(timer);
  }
}
