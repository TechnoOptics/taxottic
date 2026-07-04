// Pure mapping: a tapped notification action → what the server
// should do. Kept separate + unit-tested so the (untrusted) inbound
// action is validated in one place; the route just dispatches.
//
// `data` is the notification's data payload (built by
// lib/push/payloads.ts, string-valued). `actionId` is the button
// the OS reports the user tapped. Anything we don't recognise maps
// to "open" (foreground the app, mutate nothing), a notification
// action is untrusted and must never be a blind capability.

export type PushActionIntent =
  | { type: "reclassify_trip"; tripId: string; classification: "business" | "personal" }
  | { type: "open" };

export function resolvePushAction(
  data: Record<string, string> | null | undefined,
  actionId: string | null | undefined,
): PushActionIntent {
  const d = data ?? {};
  const action = (actionId ?? "").toLowerCase();

  // The two interactive categories both resolve a trip to
  // business/personal. CLARIFY only does so when its subject is a
  // trip; a meal/expense clarify intentionally just opens the app -
  // we never mutate financial rows straight from a lock-screen tap.
  const isTripClassify = d.kind === "trip_classify";
  const isTripClarify = d.kind === "clarify" && d.subject === "trip";
  if (
    (isTripClassify || isTripClarify) &&
    (action === "business" || action === "personal")
  ) {
    const tripId = isTripClassify ? d.tripId : d.refId;
    if (tripId) {
      return { type: "reclassify_trip", tripId, classification: action };
    }
  }
  return { type: "open" };
}
