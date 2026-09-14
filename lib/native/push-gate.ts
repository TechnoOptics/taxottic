/**
 * When the app may ask for notifications.
 *
 * Android grants an app two prompts and then blocks it (POST_NOTIFICATIONS
 * USER_FIXED), and the old init asked on every cold start, on the
 * marketing page, before sign-in: both prompts were spent on a visitor who
 * had not seen the product (Android audit C2, iOS audit I1). The spec
 * (4.5) puts the ask behind two gates: a session exists, and the user has
 * reached Today once. A denial is final for this install; the OS owns it.
 * When the feature flag is off, no prompt is ever spent on a build that cannot register.
 */
export type Receive = "prompt" | "prompt-with-rationale" | "granted" | "denied";

export function pushDecision(input: {
  hasSession: boolean;
  reachedToday: boolean;
  receive: Receive;
  pushEnabled: boolean;
}): { prompt: boolean; register: boolean; report: string } {
  if (!input.hasSession) return { prompt: false, register: false, report: "gated_no_session" };
  if (!input.reachedToday) return { prompt: false, register: false, report: "gated_before_today" };
  if (!input.pushEnabled) return { prompt: false, register: false, report: "flag_disabled" };
  if (input.receive === "denied") return { prompt: false, register: false, report: "permission_denied" };
  if (input.receive === "granted") {
    return { prompt: false, register: true, report: "register_called" };
  }
  return { prompt: true, register: false, report: "prompting" };
}
