/**
 * Find tracker alerts that were raised but never reached a human.
 *
 * THE FAILURE THIS EXISTS FOR, measured 2026-08-10.
 *
 * A driver's tracker degraded to foreground-only capture. The detector
 * caught it correctly and wrote a `foreground_only` alert on 2026-08-06.
 * Nobody found out for five days, and six days of driving went
 * unrecorded, because the only delivery path was a push notification and
 * that driver's device had zero registered tokens. Every send failed,
 * `notified_at` stayed NULL, `delivery_failed_at` was stamped, and the
 * row sat in the database describing the problem in its own `kind`
 * column while the miles disappeared.
 *
 * So the detector was never the weak link. The last mile was. An alert
 * that cannot be delivered is not a smaller problem than no alert, it is
 * a WORSE one, because the system believes it has reported and stops
 * trying while everyone downstream assumes silence means healthy.
 *
 * This module is the safety net under the safety net: it finds episodes
 * the driver was never told about, so they can be routed somewhere that
 * does not depend on push at all (a manager's screen, an email). It is
 * pure so the rule can be tested without a database or a mail server.
 */

export type TrackerAlertRow = {
  driverUserId: string;
  driverName: string | null;
  companyId: string;
  /** 'silent' | 'parked' | 'foreground_only' and any future kinds. */
  kind: string;
  /** When the episode opened. Null means the row is not a live episode. */
  stalledSince: string | null;
  /** Set ONLY when a notification actually reached the driver. */
  notifiedAt: string | null;
  /** Set when a send was attempted and failed. */
  deliveryFailedAt: string | null;
  /** Set when the episode was escalated to a manager. */
  escalatedAt: string | null;
};

export type UndeliveredAlert = TrackerAlertRow & {
  /** Hours since the episode opened. */
  stalledHours: number;
  severity: "critical" | "warning";
};

/** Past this, an unreported episode is losing real driving days. */
export const CRITICAL_AFTER_HOURS = 24;

/**
 * Don't re-email about the same driver more often than this. The episode
 * itself can persist for days; the point is that a human hears about it,
 * not that they hear about it every cron tick.
 */
export const EMAIL_EVERY_MS = 24 * 60 * 60_000;

/**
 * True when the driver was never actually told.
 *
 * `notifiedAt == null` is the whole test. `deliveryFailedAt` being set is
 * corroboration, not a requirement: an episode that has never had a
 * single successful send is undelivered whether or not the last attempt
 * recorded a failure, and requiring the failure stamp would miss an
 * episode whose sends were skipped rather than attempted.
 */
export function isUndelivered(row: TrackerAlertRow): boolean {
  return row.stalledSince != null && row.notifiedAt == null;
}

export function findUndelivered(
  rows: TrackerAlertRow[],
  nowMs: number,
): UndeliveredAlert[] {
  return rows
    .filter(isUndelivered)
    .map((r) => {
      const openedMs = Date.parse(r.stalledSince as string);
      // A row whose timestamp will not parse is still a real undelivered
      // alert. Treat its age as 0 rather than NaN, which would sort
      // unpredictably and compare false against every threshold.
      const stalledHours = Number.isFinite(openedMs)
        ? Math.max(0, (nowMs - openedMs) / 3_600_000)
        : 0;
      return {
        ...r,
        stalledHours,
        severity:
          stalledHours >= CRITICAL_AFTER_HOURS
            ? ("critical" as const)
            : ("warning" as const),
      };
    })
    // Longest-suffering first: that is the one bleeding the most miles.
    .sort((a, b) => b.stalledHours - a.stalledHours);
}

/**
 * Should this company's manager be emailed on this tick?
 *
 * Keyed on the LAST EMAIL, not on the episode, so a company with a
 * rolling set of degraded drivers still gets one message a day rather
 * than one per driver per tick.
 */
export function shouldEmailManager(args: {
  undelivered: UndeliveredAlert[];
  lastEmailedMs: number | null;
  nowMs: number;
}): boolean {
  if (args.undelivered.length === 0) return false;
  if (args.lastEmailedMs == null) return true;
  return args.nowMs - args.lastEmailedMs >= EMAIL_EVERY_MS;
}

/** One-line human summary, used as the email subject. */
export function summarize(undelivered: UndeliveredAlert[]): string {
  if (undelivered.length === 0) return "No tracker problems";
  const worst = undelivered[0];
  const who = worst.driverName ?? "A driver";
  const days = Math.floor(worst.stalledHours / 24);
  const age =
    days >= 1
      ? `${days} day${days === 1 ? "" : "s"}`
      : `${Math.max(1, Math.round(worst.stalledHours))} hour${
          Math.round(worst.stalledHours) === 1 ? "" : "s"
        }`;
  const others =
    undelivered.length > 1
      ? ` (and ${undelivered.length - 1} other${undelivered.length === 2 ? "" : "s"})`
      : "";
  return `${who}'s mileage tracker has been degraded for ${age}${others}`;
}

/** Plain-English explanation of a `kind`, for people who do not read enums. */
export function explainKind(kind: string): string {
  switch (kind) {
    case "foreground_only":
      return "Capturing only while the app is open on screen. Drives taken with the phone locked or the app closed are not being recorded.";
    case "silent":
      return "No location data has arrived at all.";
    case "parked":
      return "The phone has been stationary far longer than expected, which can mean capture stopped rather than that nobody drove.";
    default:
      return "The tracker is not reporting normally.";
  }
}
