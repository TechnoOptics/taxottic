import { haversineMeters } from "./segmentation";

/**
 * Should this fix be buffered and uploaded, or is it a parked phone's
 * GPS scatter?
 *
 * MEASURED 2026-08-10, the owner's Fold, 2.6 hours parked at home: 140
 * points, one every ~68 seconds, average movement 0.8 m and a MAXIMUM of
 * 7.7 m. The watcher's distanceFilter is 25 m and suppressed none of it,
 * because the plugin emits on a time basis regardless of distance. That
 * is roughly 1,200 rows a day per driver carrying no information, and it
 * grows linearly with the fleet.
 *
 * TWO CONSTRAINTS PULL IN OPPOSITE DIRECTIONS HERE, and getting either
 * wrong costs a driver real mileage.
 *
 * DRIVE DETECTION MUST NOT SLIP. It cannot: a drive moves further than
 * the distance filter by definition, so anything beyond PARKED_RADIUS_M
 * is kept immediately with no keepalive wait. Suppression only ever
 * applies to fixes that carry no positional information.
 *
 * LIVENESS MUST NOT STOP. This is the subtle one. The heartbeat rides
 * ingest (lib/mileage/heartbeat-timer.ts), and finalize's tail-close
 * needs a heartbeat NEWER than the last point to tell an idle phone from
 * a silent one (lib/mileage/tail-close.ts). Filtering parked fixes to
 * ZERO would stop the heartbeat, re-break the visibility restored in
 * #545 and #547, and hang trips open again. So this is a floor, not a
 * mute: a parked phone still reports, at a tenth of the volume.
 */

/**
 * Movement below this is scatter, not travel.
 *
 * Sits at or above the watcher's 25 m distanceFilter deliberately, so a
 * fix this function drops is one the plugin should not have emitted
 * anyway. Measured worst-case scatter on a stationary phone was 7.7 m,
 * so there is roughly 4x headroom before real movement is at risk.
 */
export const PARKED_RADIUS_M = 30;

/**
 * A parked phone still reports this often, so it never looks dead.
 *
 * Bounded above by TRIP_END_DWELL_MS: a gap longer than the dwell that
 * closes a trip would make a parked phone indistinguishable from a
 * silent one, and finalize would hang trips open waiting for evidence
 * that never came. Ten minutes is exactly the dwell, so tail-close
 * behaviour is inherited unchanged rather than re-reasoned.
 */
export const PARKED_KEEPALIVE_MS = 10 * 60_000;

type Fix = { lat: number; lng: number; ts: number };

/**
 * Keep the fix if it moved, or if the device is due to prove it is alive.
 *
 * An out-of-order fix (negative elapsed) is KEPT rather than judged. A
 * late arrival in a batch is normal, and the cost of keeping one stray
 * point is a row, while the cost of dropping a real one is mileage.
 */
export function shouldKeepFix(args: {
  fix: Fix;
  lastKept: Fix | null;
}): boolean {
  const { fix, lastKept } = args;
  if (!lastKept) return true;

  const elapsed = fix.ts - lastKept.ts;
  if (elapsed < 0) return true;
  if (elapsed >= PARKED_KEEPALIVE_MS) return true;

  return haversineMeters(lastKept, fix) > PARKED_RADIUS_M;
}
