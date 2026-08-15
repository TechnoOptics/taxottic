/**
 * Remind a driver about drives still waiting on them.
 *
 * WHY EMAIL FIRST, and this is not a preference.
 *
 * There are zero iOS push tokens in production. A push-only reminder
 * would notify the Android driver and do nothing at all for the driver
 * whose drives are most affected, while the system recorded a
 * successful send. That is exactly the single-channel failure that let
 * a broken tracker sit unnoticed for five days: the alarm fired into a
 * channel nobody was listening on, and the silence read as health.
 *
 * Email shares no infrastructure with push. No device token, no APNs
 * credential, no app install, no WebView. Push can be added later as an
 * enhancement, never as the only path.
 *
 * WHY THIS IS GENTLER THAN THE TRACKER ALARM.
 *
 * A degraded tracker is losing money every hour and is worth a daily
 * email. An unconfirmed drive is already recorded, already counted, and
 * merely wants a yes or no. Nagging daily about it trains people to
 * filter the sender, which then buries the alarm that does matter. So
 * the cadence is slower and the first reminder waits.
 */

export type PendingDrive = {
  tripId: string;
  driverUserId: string;
  driverName: string | null;
  driverEmail: string | null;
  /** ISO. */
  startedAt: string;
  distanceMiles: number;
  /** Human labels, now that trips finally carry endpoints. Null is fine. */
  startPlace: string | null;
  endPlace: string | null;
  /** Last time this driver was emailed about confirmations. */
  lastRemindedAt: string | null;
};

/**
 * Leave a drive alone for its first day. Auto-apply resolves most
 * drives on its own, and the driver often opens the app the same
 * evening. Emailing inside that window mostly generates mail about
 * things that were about to sort themselves out.
 */
export const QUIET_PERIOD_MS = 24 * 60 * 60_000;

/**
 * One reminder every three days per driver. See the header: this is
 * deliberately slower than the tracker alarm's 24h.
 */
export const REMIND_EVERY_MS = 3 * 24 * 60 * 60_000;

/** Past this a drive is at real risk of being forgotten before filing. */
export const STALE_AFTER_DAYS = 14;

export type DriverReminder = {
  driverUserId: string;
  driverName: string | null;
  driverEmail: string;
  drives: PendingDrive[];
  totalMiles: number;
  oldestDays: number;
  /** True when at least one drive has been waiting past STALE_AFTER_DAYS. */
  hasStale: boolean;
};

/** Drives old enough to be worth mentioning. */
export function ripe(drives: PendingDrive[], nowMs: number): PendingDrive[] {
  return drives.filter((d) => {
    const started = Date.parse(d.startedAt);
    if (!Number.isFinite(started)) return false;
    return nowMs - started >= QUIET_PERIOD_MS;
  });
}

/**
 * Group into one reminder per driver, dropping anyone who was reminded
 * too recently or who has no address to reach.
 */
export function buildReminders(
  drives: PendingDrive[],
  nowMs: number,
): DriverReminder[] {
  const byDriver = new Map<string, PendingDrive[]>();
  for (const d of ripe(drives, nowMs)) {
    const list = byDriver.get(d.driverUserId) ?? [];
    list.push(d);
    byDriver.set(d.driverUserId, list);
  }

  const out: DriverReminder[] = [];
  for (const [driverUserId, list] of byDriver) {
    const email = list[0].driverEmail?.trim();
    // No address is not an error to retry, it is a driver we cannot
    // reach by this channel at all. Skip quietly; the in-app queue
    // still shows them.
    if (!email) continue;

    // Throttle on the most recent reminder across this driver's pending
    // drives, so a driver who accumulates new drives daily still gets
    // one message every three days rather than one per drive.
    const lastMs = list
      .map((d) => (d.lastRemindedAt ? Date.parse(d.lastRemindedAt) : null))
      .filter((n): n is number => n != null && Number.isFinite(n))
      .reduce<number | null>((a, b) => (a == null || b > a ? b : a), null);
    if (lastMs != null && nowMs - lastMs < REMIND_EVERY_MS) continue;

    // Oldest first: that is the one nearest to being forgotten.
    const sorted = [...list].sort(
      (a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt),
    );
    const oldestDays = Math.floor(
      (nowMs - Date.parse(sorted[0].startedAt)) / 86_400_000,
    );

    out.push({
      driverUserId,
      driverName: sorted[0].driverName,
      driverEmail: email,
      drives: sorted,
      totalMiles: Number(
        sorted.reduce((s, d) => s + (d.distanceMiles || 0), 0).toFixed(1),
      ),
      oldestDays,
      hasStale: oldestDays >= STALE_AFTER_DAYS,
    });
  }
  return out.sort((a, b) => b.oldestDays - a.oldestDays);
}

/** "home to office" when both ends are known, else the honest partial. */
export function routeLabel(d: PendingDrive): string {
  if (d.startPlace && d.endPlace) return `${d.startPlace} to ${d.endPlace}`;
  if (d.startPlace) return `from ${d.startPlace}`;
  if (d.endPlace) return `to ${d.endPlace}`;
  // Endpoints only started being recorded on 2026-08-15, and a drive
  // between two unknown places still has none. Say nothing rather than
  // print "unknown to unknown", which reads like a bug.
  return "";
}

/** Subject line. Concrete, no urgency theatre. */
export function summarize(r: DriverReminder): string {
  const n = r.drives.length;
  const drive = n === 1 ? "drive" : "drives";
  if (r.hasStale) {
    return `${n} ${drive} still waiting to be confirmed, the oldest for ${r.oldestDays} days`;
  }
  return `${n} ${drive} waiting to be confirmed (${r.totalMiles} miles)`;
}
