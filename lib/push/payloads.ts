// Pure event → push-payload mapping. No I/O, fully unit-tested.
//
// Privacy: APNs/FCM payloads are visible on the lock screen before
// unlock and in transit metadata. The BODY never carries dollar
// amounts, vendor names, or other detail, only "something happened,
// open to see." The routing detail lives in `data` (not shown) for
// the action handlers / deep links. This is a deliberate constraint
// the spec calls out; keep it.

export type PushEvent =
  | {
      kind: "trip_classify";
      tripId: string;
      /** Snippet for the banner: "3.2 mi · 7:41 PM". Optional so older
       *  producers keep compiling; the copy degrades to the generic
       *  question. */
      miles?: number;
      whenLabel?: string;
    }
  /**
   * "Trip logged", fires for every materialized trip that the
   * segmenter already auto-classified business or personal (the
   * remaining case is `trip_classify`, which asks the user). Body
   * follows the same no-detail privacy rule: "Drive logged" + no
   * miles, no dollar amount, no place names visible on the lock
   * screen. The opener of the notification deep-links to /mileage
   * via the data payload.
   */
  | {
      kind: "trip_logged";
      tripId: string;
      classification: "business" | "personal";
    }
  | {
      kind: "clarify";
      subject: "meal" | "expense" | "trip";
      refId: string;
    }
  | { kind: "expense_applied"; refId: string }
  | { kind: "goal_met"; goalLabel: string; goalId: string }
  | { kind: "badge_awarded"; badgeLabel: string; badgeCode: string }
  | { kind: "message"; fromName: string; threadId: string; messageId: string }
  /**
   * Periodic nudge for the "outstanding tasks" backlog (unclassified
   * drives + transactions awaiting a category). `count` rides in
   * `data` only, same no-detail-on-the-lock-screen rule as every
   * other kind, for the in-app bell/badge to read after the tap.
   * `dayKey` (the caller's local YYYY-MM-DD) is folded into the
   * dedupe key so at most one of these fires per user per day,
   * however often the cron runs, keeps this a pure function (no
   * Date.now() inside payloads.ts).
   */
  | { kind: "outstanding_reminder"; count: number; dayKey: string }
  /**
   * The mileage tracker went silent server-side (no raw points for
   * hours from a driver who was uploading recently) — almost always
   * iOS reverting Location "Always" → "While Using", or the toggle /
   * app getting killed. The in-app banner can't reach a closed app;
   * this push can. `dayKey` folds into the dedupe key so however
   * often the cron sweeps, at most one fires per driver per day.
   */
  | { kind: "tracker_stalled"; dayKey: string }
  | { kind: "tracker_parked"; dayKey: string }
  /** Sent to a MANAGER when a driver's tracker is dead AND the driver
   *  themselves could not be reached (no registered device, or every
   *  token failed). Carries no location and no distance: it is a
   *  "someone needs a nudge" signal, not a report on where they were. */
  | {
      kind: "driver_tracker_unreachable";
      driverLabel: string;
      driverId: string;
      dayKey: string;
    };

export type PushPayload = {
  title: string;
  body: string;
  /** iOS UNNotificationCategory id / Android channel, Phase 2 wires
   *  the interactive actions to these. */
  category?: string;
  /** Routing only, never displayed. Strings (APNs/FCM data is
   *  string-valued). */
  data: Record<string, string>;
  /** Stable per logical event → notification_log idempotency. */
  dedupeKey: string;
};

/**
 * Build the payload for an event. `title`/`body` are intentionally
 * generic; `category` is set only for the two interactive kinds so
 * Phase 2 can attach Business/Personal actions.
 */
export function buildPayload(e: PushEvent): PushPayload {
  switch (e.kind) {
    case "trip_classify": {
      // Snippet-first copy: the user classifies from the shade without
      // opening the app, so the banner must SAY which drive this is.
      const snippet =
        e.miles != null
          ? `${e.miles.toFixed(1)} mi drive${e.whenLabel ? ` · ${e.whenLabel}` : ""}`
          : null;
      return {
        title: snippet ?? "New drive logged",
        body: snippet
          ? "Business or personal? Tap to classify."
          : "Was this trip for business?",
        category: "TRIP_CLASSIFY",
        data: { kind: e.kind, tripId: e.tripId },
        dedupeKey: `trip_classify:${e.tripId}`,
      };
    }
    case "trip_logged":
      return {
        title: "Drive logged",
        body:
          e.classification === "business"
            ? "A business drive was added to your books."
            : "A personal drive was logged.",
        data: {
          kind: e.kind,
          tripId: e.tripId,
          classification: e.classification,
        },
        dedupeKey: `trip_logged:${e.tripId}`,
      };
    case "clarify":
      return {
        title: "Quick check",
        body:
          e.subject === "meal"
            ? "Was this meal a business expense?"
            : e.subject === "trip"
              ? "Was this trip for business?"
              : "Was this a business expense?",
        category: "CLARIFY",
        data: { kind: e.kind, subject: e.subject, refId: e.refId },
        dedupeKey: `clarify:${e.subject}:${e.refId}`,
      };
    case "expense_applied":
      return {
        title: "Expense added",
        body: "A new expense was added to your books.",
        data: { kind: e.kind, refId: e.refId },
        dedupeKey: `expense_applied:${e.refId}`,
      };
    case "goal_met":
      return {
        title: "Goal reached",
        body: `You hit your "${e.goalLabel}" goal.`,
        data: { kind: e.kind, goalId: e.goalId },
        dedupeKey: `goal_met:${e.goalId}`,
      };
    case "badge_awarded":
      return {
        title: "Badge earned",
        body: `You earned "${e.badgeLabel}".`,
        data: { kind: e.kind, badgeCode: e.badgeCode },
        dedupeKey: `badge_awarded:${e.badgeCode}`,
      };
    case "message":
      return {
        title: "New message",
        body: `${e.fromName} sent you a message.`,
        data: { kind: e.kind, threadId: e.threadId, messageId: e.messageId },
        dedupeKey: `message:${e.threadId}:${e.messageId}`,
      };
    case "outstanding_reminder":
      return {
        // Same no-detail privacy rule as every other kind: the count is
        // useful for the in-app bell/badge, but the lock-screen body stays
        // generic, "something's waiting, open to see", not a number.
        title: "A few things need a quick look",
        body: "Some drives or transactions are waiting for a business-or-personal call.",
        data: { kind: e.kind, count: String(e.count) },
        dedupeKey: `outstanding_reminder:${e.dayKey}`,
      };
    case "tracker_stalled":
      return {
        title: "Mileage tracking stopped",
        body:
          "Your phone hasn't sent any drive data in a while. Open Taxottic to turn tracking back on.",
        data: { kind: e.kind },
        dedupeKey: `tracker_stalled:${e.dayKey}`,
      };
    case "tracker_parked":
      return {
        // The device is reporting fine but hasn't moved in days: tracking
        // is "working" and still missing every real drive, so the ask is
        // different from tracker_stalled — confirm it's the right phone.
        title: "Is this the phone you drive with?",
        body:
          "Taxottic is running here, but this phone hasn't been on a drive in days. If you drive with a different phone, set up tracking there.",
        data: { kind: e.kind },
        dedupeKey: `tracker_parked:${e.dayKey}`,
      };
    case "driver_tracker_unreachable":
      return {
        // The escalation of last resort. A driver whose tracker is dead
        // and whose phone we cannot reach is invisible to everyone: the
        // in-app banner needs the app open, and the push needs a
        // registered device. Telling the manager is the only remaining
        // channel, and it is how Grace's iOS device stayed dark for two
        // days in August 2026 while the alert row claimed she was told.
        title: "A driver's mileage tracking stopped",
        body: `${e.driverLabel} hasn't sent drive data in a while, and we couldn't reach their phone. They may need to reopen Taxottic.`,
        data: { kind: e.kind, driverId: e.driverId },
        // Per driver per day: one manager nudge a day per affected
        // driver, not one per cron tick.
        dedupeKey: `driver_tracker_unreachable:${e.driverId}:${e.dayKey}`,
      };
  }
}
