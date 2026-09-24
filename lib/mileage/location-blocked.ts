/**
 * A permission the phone has already diagnosed. iOS moved one driver from
 * Always to While Using on 2026-08-20 and nothing recorded for 20 days
 * while the self-repair sat in location_always:waiting (iOS audit C4).
 * The state is now blocking: the dashboard says so, the tracking toggle
 * cannot read on, and the heartbeat stores the state on the row, so a
 * query can tell a blocked phone from one that is merely backing off.
 */
/**
 * How old a cached device-truth read may be and still be allowed to put a
 * control into the blocked branch.
 *
 * The cache is only rewritten by a live probe, and a live probe only runs
 * from the tracker's own start path. A driver whose tracking is off
 * therefore carries the last whenInUse the phone ever reported for as
 * long as the install lasts, so seeding from an unbounded cache would
 * latch the block and leave no way out of it for a driver who has since
 * granted Always. Ten minutes is a foreground session: fresher than that
 * and the read is this sitting, older and the phone is asked again.
 */
export const BLOCK_FROM_CACHE_MAX_AGE_MS = 10 * 60_000;

/**
 * The authorization a cached read is allowed to assert, or null when the
 * read is too old to speak for the phone as it is now.
 */
export function authorizationFromCache(
  cached: { locationAuthorization: string | null; ageMs: number } | null,
): string | null {
  if (!cached || cached.ageMs > BLOCK_FROM_CACHE_MAX_AGE_MS) return null;
  return cached.locationAuthorization;
}

/**
 * How old a `mileage_device_status` row may be and still put the strip on
 * Today.
 *
 * The row is the last thing the phone said, not a live probe, and nothing
 * rewrites it while the app is not running. A driver who reinstalled, or
 * granted Always months ago on a phone that has not beaten since, would
 * otherwise carry a permanent strip naming a fault that no longer exists.
 * Two weeks is longer than any normal gap between drives and short enough
 * that a stale install stops speaking.
 */
export const DEVICE_STATUS_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The oldest `reported_at` a row may carry and still speak for the phone,
 * as the ISO string PostgREST wants. The clock read lives here rather
 * than at the call site so the server component stays pure.
 */
export function deviceStatusFloorIso(now: number = Date.now()): string {
  return new Date(now - DEVICE_STATUS_MAX_AGE_MS).toISOString();
}

export function locationBlocked(
  status: { locationAuthorization: string | null; trackingEnabled: boolean | null } | null,
): { blocked: boolean; short: string; fix: string } | null {
  if (!status || status.locationAuthorization !== "whenInUse") return null;
  // A driver who switched tracking off is not blocked, they chose. Only
  // an explicit false counts: null is the pre-plugin shape of the column
  // and says nothing about what the driver asked for.
  if (status.trackingEnabled === false) return null;
  return {
    blocked: true,
    short: "Location is While Using, so drives are not recorded off screen",
    fix: "Settings, Taxottic, Location, Always",
  };
}
