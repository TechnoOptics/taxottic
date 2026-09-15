/**
 * A permission the phone has already diagnosed. iOS moved one driver from
 * Always to While Using on 2026-08-20 and nothing recorded for 20 days
 * while the self-repair sat in location_always:waiting (iOS audit C4).
 * The state is now blocking: the dashboard says so, the tracking toggle
 * cannot read on, and the manager card counts the attempts.
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

export function locationBlocked(
  status: { locationAuthorization: string | null; trackingEnabled: boolean | null } | null,
): { blocked: boolean; short: string; fix: string } | null {
  if (!status || status.locationAuthorization !== "whenInUse") return null;
  return {
    blocked: true,
    short: "Location is While Using, so drives are not recorded off screen",
    fix: "Settings, Taxottic, Location, Always",
  };
}
