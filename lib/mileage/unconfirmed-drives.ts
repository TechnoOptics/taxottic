/**
 * Tell a driver, promptly, which drives are waiting on a decision.
 *
 * WHY EMAIL, and this is not a preference.
 *
 * There are zero iOS push tokens in production. A push-only reminder
 * would notify the Android driver and do nothing at all for the driver
 * whose drives are most affected, while the system recorded a
 * successful send. That is exactly the single-channel failure that let
 * a broken tracker sit unnoticed for five days: the alarm fired into a
 * channel nobody was listening on, and the silence read as health.
 *
 * Email shares no infrastructure with push. No device token, no APNs
 * credential, no app install, no WebView.
 *
 * WHY THE CADENCE CHANGED ON 2026-08-24.
 *
 * The first version of this file waited 24 hours from a drive's START
 * before mentioning it, then let one throttle govern every message: one
 * email per driver per three days. Measured against production, that
 * combination produced first notifications 23.7 to 43.7 hours after the
 * drive ended. Trip 68e4fcb2 ended 2026-08-22 21:46 and was first
 * mailed 2026-08-24 17:31.
 *
 * The 43.7 hours were not the 24-hour wait. They were the throttle. The
 * sweep rewrites confirmation_reminded_at on EVERY pending drive at
 * send time, and the throttle read max() across them, so a driver who
 * never clears their backlog resets their own three-day clock every
 * three days. A drive finishing the day after a send inherits the
 * backlog's anniversary and waits for it. The worse the backlog, the
 * later a fresh drive gets reported, which is precisely backwards. Two
 * drivers swept three hours apart on 2026-08-24 differed only in that:
 * the one with a single pending drive was told in 23.7 hours, the one
 * with ten was told in 43.7.
 *
 * A driver asked whether a drive eleven days ago was business will
 * guess, and avoiding a guess is the entire reason the confirmation
 * step exists.
 *
 * So there are now two speeds, and they answer two different questions:
 *
 *   Is there something the driver has NEVER been told about?
 *     -> say so soon, floored at NEW_DRIVE_MIN_GAP_MS.
 *   Is this the same backlog they already have a message about?
 *     -> keep the gentle REMIND_EVERY_MS cadence. Nagging daily about
 *        an already-reported drive trains people to filter the sender,
 *        which then buries the tracker alarm that does matter.
 *
 * One path, not two. A second sweep writing the same column would race
 * this one and each would reset the other's throttle.
 */

export type PendingDrive = {
  tripId: string;
  driverUserId: string;
  driverName: string | null;
  driverEmail: string | null;
  /** ISO. */
  startedAt: string;
  /** ISO. When the driver parked, which is when the clock the driver
   *  actually experiences starts running. */
  endedAt: string;
  distanceMiles: number;
  /** Human labels, now that trips finally carry endpoints. Null is fine. */
  startPlace: string | null;
  endPlace: string | null;
  /** Last time this driver was emailed about confirmations. */
  lastRemindedAt: string | null;
};

/**
 * How long after a drive ENDS before it is worth mentioning.
 *
 * This is a settle window, not a quiet period. Its only job is to let a
 * multi-leg errand finish so the legs arrive in one email rather than
 * one message per leg: a drive ending at 17:02 and another at 17:40
 * are the same trip out as far as the driver is concerned.
 *
 * It replaced a 24-hour wait measured from the drive's START. The old
 * comment justified that wait by saying auto-apply and the driver's own
 * evening app-open would resolve most drives anyway. Production says
 * otherwise: eleven drives were still unconfirmed on 2026-08-24, the
 * oldest from 2026-07-29. Waiting a day mostly delayed the ask, it did
 * not avoid it.
 */
export const SETTLE_PERIOD_MS = 30 * 60_000;

/**
 * Floor between two emails to the same driver when at least one drive
 * has never been mentioned.
 *
 * Six drives in a day must not be six emails.
 *
 * WHY ONE HOUR AND NOT SIX. This shipped at six hours, and production
 * showed within the day that six is the wrong number for the thing this
 * feature was asked for. On 2026-08-24 a driver was emailed at 17:31,
 * then took five drives ending 19:18, 19:27, 19:31, 19:40 and 19:49.
 * The six-hour floor held every one of them until 23:31, about four
 * hours after the first. The request was to be told when a drive
 * completes, and four hours does not meet it.
 *
 * The floor is not what stops a burst becoming a burst of email:
 * SETTLE_PERIOD_MS already collapses drives that end close together
 * into one message, and those five would have gone out as a single
 * email either way. The floor only governs how soon the NEXT message
 * may follow, so pricing it for the pathological case bought little
 * and cost the timeliness the feature exists for.
 *
 * One hour is 24 messages a day in theory. In practice the observed
 * rate is about 0.4 unconfirmed drives per day across the whole fleet,
 * and the settle window batches, so a heavy driving day is two or three
 * emails and an ordinary day is one or none.
 *
 * The 45-day backfill case is still bounded, by three other things that
 * do not depend on this number: per-driver aggregation, MAX_LISTED, and
 * the settle window. This was never the control holding that line.
 */
export const NEW_DRIVE_MIN_GAP_MS = 60 * 60_000;

/**
 * Cadence for a repeat message about drives the driver has already been
 * told about. Deliberately slower than the tracker alarm's 24h: a
 * degraded tracker is losing money every hour, an unconfirmed drive is
 * already recorded and merely wants a yes or no.
 */
export const REMIND_EVERY_MS = 3 * 24 * 60 * 60_000;

/**
 * How recently a drive must have ended for the email to be allowed to
 * say it "just finished". See DriverReminder.justFinished.
 */
export const JUST_FINISHED_WITHIN_MS = 24 * 60 * 60_000;

/** Past this a drive is at real risk of being forgotten before filing. */
export const STALE_AFTER_DAYS = 14;

/**
 * How many drives the email enumerates.
 *
 * A reinstall triggers a 45-day recovery sweep, which can materialise
 * dozens of drives at once. Per-driver aggregation already makes that
 * one email rather than a wall of them; this keeps that one email
 * readable. The count and the mileage still describe every pending
 * drive, so the cap shortens the list without understating the backlog,
 * and the button goes to the queue that holds all of them.
 */
export const MAX_LISTED = 12;

export type DriverReminder = {
  driverUserId: string;
  driverName: string | null;
  driverEmail: string;
  /** Every ripe pending drive. What gets counted and stamped. */
  drives: PendingDrive[];
  /** The slice the email enumerates, oldest first. See MAX_LISTED. */
  listed: PendingDrive[];
  /** drives.length - listed.length. Zero for a normal backlog. */
  omitted: number;
  /** How many of `drives` have never been mentioned to this driver. */
  newDrives: number;
  /**
   * Every drive here is both unmentioned AND ended within the last day.
   *
   * Never-mentioned is NOT the same as recent: a drive from 2026-07-29
   * that this sweep has never reached is unmentioned and three weeks
   * old. Saying "just finished" about it would be a small lie in the
   * subject line of an email whose entire purpose is to stop the driver
   * guessing.
   */
  justFinished: boolean;
  totalMiles: number;
  oldestDays: number;
  /** True when at least one drive has been waiting past STALE_AFTER_DAYS. */
  hasStale: boolean;
};

/**
 * Drives that have settled and are worth mentioning.
 *
 * Gates on `endedAt`. Reading `startedAt`, which is what this did until
 * 2026-08-24, calls a drive that began three days ago and parked five
 * minutes ago ripe, and mails the driver mid-errand.
 */
export function ripe(drives: PendingDrive[], nowMs: number): PendingDrive[] {
  return drives.filter((d) => {
    const ended = Date.parse(d.endedAt);
    if (!Number.isFinite(ended)) return false;
    return nowMs - ended >= SETTLE_PERIOD_MS;
  });
}

/**
 * Group into one reminder per driver, dropping anyone whose turn has
 * not come round or who has no address to reach.
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
    // one message per window rather than one per drive.
    const lastMs = list
      .map((d) => (d.lastRemindedAt ? Date.parse(d.lastRemindedAt) : null))
      .filter((n): n is number => n != null && Number.isFinite(n))
      .reduce<number | null>((a, b) => (a == null || b > a ? b : a), null);

    // Which window applies depends on whether there is anything to say
    // that the driver has not already been sent. See the file header:
    // making a never-mentioned drive wait for the backlog's anniversary
    // is what produced the 43.7-hour first notification.
    const newDrives = list.filter((d) => !d.lastRemindedAt).length;
    const gap = newDrives > 0 ? NEW_DRIVE_MIN_GAP_MS : REMIND_EVERY_MS;
    if (lastMs != null && nowMs - lastMs < gap) continue;

    // Oldest first: that is the one nearest to being forgotten, and so
    // the one that survives the MAX_LISTED cap.
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
      listed: sorted.slice(0, MAX_LISTED),
      omitted: Math.max(0, sorted.length - MAX_LISTED),
      newDrives,
      justFinished:
        newDrives === sorted.length &&
        sorted.every(
          (d) => nowMs - Date.parse(d.endedAt) < JUST_FINISHED_WITHIN_MS,
        ),
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

/**
 * Subject line. Concrete, no urgency theatre, and it names the decision
 * being asked for rather than announcing that a drive happened. "Drive
 * logged" is information; "needs a business or personal call" is the
 * thing the driver can act on.
 *
 * No dollar figure appears here or in the body. The deduction depends
 * on the answer the driver has not given yet, so quoting one would be
 * quoting a number the driver never confirmed.
 */
export function summarize(r: DriverReminder): string {
  const n = r.drives.length;
  const drive = n === 1 ? "drive" : "drives";
  if (r.justFinished) {
    return n === 1
      ? "1 drive just finished and needs a business or personal call"
      : `${n} drives just finished and need a business or personal call`;
  }
  if (r.hasStale) {
    return `${n} ${drive} still waiting to be confirmed, the oldest for ${r.oldestDays} days`;
  }
  return `${n} ${drive} waiting to be confirmed (${r.totalMiles} miles)`;
}
