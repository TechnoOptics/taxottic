/**
 * A permission the phone has already diagnosed. iOS moved one driver from
 * Always to While Using on 2026-08-20 and nothing recorded for 20 days
 * while the self-repair sat in location_always:waiting (iOS audit C4).
 * The state is now blocking: the dashboard says so, the tracking toggle
 * cannot read on, and the manager card counts the attempts.
 */
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
