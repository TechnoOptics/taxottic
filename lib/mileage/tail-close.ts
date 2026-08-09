import { TRIP_END_DWELL_MS } from "./segmentation";

/**
 * Absolute backstop for an open trip.
 *
 * A phone switched off, reinstalled, or out of coverage overnight must not
 * leave a drive open forever: an open trip has not materialised, so it is
 * not on the map and not in the deduction.
 *
 * Six hours sits far above the worst upload stall ever measured here (152
 * minutes on 2026-08-09), which matters because every minute of headroom
 * we remove is a minute in which a bad-signal afternoon silently
 * reintroduces the fragmentation this module exists to prevent.
 */
export const TAIL_CLOSE_CEILING_MS = 6 * 60 * 60 * 1000;

/**
 * Should finalize close the trip that is still open at the end of the
 * point stream?
 *
 * The old rule was `forceClose || lastPointAgeMs >= TRIP_END_DWELL_MS`,
 * and its flaw is that `lastPointAgeMs` measures the newest point THE
 * SERVER HAS. That is upload recency, not driving. A phone whose WebView
 * cannot flush is indistinguishable from a parked car.
 *
 * On 2026-08-09 that cost three drives in one day. Eleven upload stalls of
 * 11 to 152 minutes, GPS capture running fine throughout, and every single
 * trip boundary landed on a stall boundary (15:23:00 / 15:23:01,
 * 17:43:12 / 17:43:12, 20:03:41 / 20:03:41). Each drive was closed at the
 * last uploaded point and the backlog became a second trip six seconds
 * later.
 *
 * So closing now requires positive evidence the device is IDLE rather than
 * merely SILENT:
 *
 *   forceClose            an explicit, evidence-backed end (sessionEnded,
 *                         walked-away). Always honoured.
 *   heartbeat after       the phone was alive and produced no GPS for a
 *   the last point +      whole dwell. That is a parked car, and it is the
 *   the dwell             only case the old rule was ever right about.
 *   past the ceiling      backstop, see TAIL_CLOSE_CEILING_MS.
 *
 * Anything else stays open. A silent phone cannot be told apart from a
 * stalled one, and the cost of the two mistakes is not symmetric: leaving
 * a trip open delays it by one finalize pass, whereas closing it early
 * severs a real drive and permanently understates the deduction.
 *
 * Heartbeats ride the same fetch path as the points (see
 * lib/mileage/heartbeat-timer.ts), so an upload stall silences both. That
 * is what makes "a heartbeat arrived after the last point" strong
 * evidence rather than a coincidence: during a stall it cannot happen.
 */
export function shouldCloseOpenTail(args: {
  forceClose: boolean;
  /** captured_at of the newest point in the pool, epoch ms. */
  lastPointTs: number;
  /** mileage_device_status.reported_at, epoch ms, or null if never. */
  deviceReportedAtMs: number | null;
  nowMs: number;
}): boolean {
  const { forceClose, lastPointTs, deviceReportedAtMs, nowMs } = args;
  if (forceClose) return true;

  const ageMs = nowMs - lastPointTs;
  if (ageMs < TRIP_END_DWELL_MS) return false;
  if (ageMs >= TAIL_CLOSE_CEILING_MS) return true;

  // Alive, and quiet for a full dwell: parked.
  return (
    deviceReportedAtMs !== null &&
    deviceReportedAtMs >= lastPointTs + TRIP_END_DWELL_MS
  );
}
