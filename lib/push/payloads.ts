// Pure event → push-payload mapping. No I/O, fully unit-tested.
//
// Privacy: APNs/FCM payloads are visible on the lock screen before
// unlock and in transit metadata. The BODY never carries dollar
// amounts, vendor names, or other detail — only "something happened,
// open to see." The routing detail lives in `data` (not shown) for
// the action handlers / deep links. This is a deliberate constraint
// the spec calls out; keep it.

export type PushEvent =
  | { kind: "trip_classify"; tripId: string }
  | {
      kind: "clarify";
      subject: "meal" | "expense" | "trip";
      refId: string;
    }
  | { kind: "expense_applied"; refId: string }
  | { kind: "goal_met"; goalLabel: string; goalId: string }
  | { kind: "badge_awarded"; badgeLabel: string; badgeCode: string }
  | { kind: "message"; fromName: string; threadId: string; messageId: string };

export type PushPayload = {
  title: string;
  body: string;
  /** iOS UNNotificationCategory id / Android channel — Phase 2 wires
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
    case "trip_classify":
      return {
        title: "New drive logged",
        body: "Was this trip for business?",
        category: "TRIP_CLASSIFY",
        data: { kind: e.kind, tripId: e.tripId },
        dedupeKey: `trip_classify:${e.tripId}`,
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
  }
}
