// Shared scheduling helpers for recurring invoice templates.
//
// Split out from the server-action file so the cron route (which
// is a separate compilation unit) can import the helper without
// pulling in the rest of the `"use server"` module — server-action
// files can only export async functions.

export type Cadence = "monthly" | "quarterly" | "annual";

/**
 * Compute the next scheduled issue date for a template.
 *
 * Anchors to UTC noon to avoid DST drift and timezone edge cases
 * (a template anchored to "the 1st of the month" should always
 * fire on day 1 in UTC, never bouncing into day 31 of the prior
 * month on the day clocks change).
 */
export function computeNextIssueAt(args: {
  cadence: Cadence;
  issueDayOfMonth: number | null;
  reference: Date;
}): Date {
  const day = Math.min(28, Math.max(1, args.issueDayOfMonth ?? 1));
  const next = new Date(
    Date.UTC(
      args.reference.getUTCFullYear(),
      args.reference.getUTCMonth(),
      day,
      12,
      0,
      0,
    ),
  );
  // If the anchored day has already passed this period, roll forward.
  if (next <= args.reference) {
    if (args.cadence === "monthly") {
      next.setUTCMonth(next.getUTCMonth() + 1);
    } else if (args.cadence === "quarterly") {
      next.setUTCMonth(next.getUTCMonth() + 3);
    } else {
      next.setUTCFullYear(next.getUTCFullYear() + 1);
    }
  }
  return next;
}
