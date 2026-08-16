/**
 * Does a device's own heartbeat prove the tracker is broken?
 *
 * WHY THIS EXISTS. The finalize cron already escalated on two device
 * signals (no native callback for 30+ min, authorization degraded from
 * Always) but the logic lived inline in the route, untested, and it did
 * not read `self_check` at all.
 *
 * That omission has a measured cost. The self-check wrote
 * `dead=device_status_plugin,geofence_plugin` into every heartbeat from
 * a broken iPhone, and separately `push_registration_state` held the
 * exact cause of a dead push subsystem, naming the missing entitlement,
 * for NINE DAYS. In both cases the system had the answer and waited for
 * a human to think of the right query. Nobody did.
 *
 * The point of this module is that a `dead=` verdict should escalate by
 * itself, because a dead capability means mileage is not being recorded
 * and the driver's deduction is quietly not accruing.
 *
 * WHAT IT DELIBERATELY DOES NOT ESCALATE
 *
 * `degraded=` is excluded. It means a device setting the DRIVER controls
 * is throttling us (Low Power Mode, Battery Saver): real, worth showing
 * them in the app, and not a reason to fire the same alarm we use for
 * "we shipped something broken". Escalating both through one channel is
 * how an alarm becomes noise, and this codebase already learned that a
 * check people mute is worse than no check.
 *
 * Pure, so the escalation rules are testable without a cron, a database
 * or a device.
 */

/** Beyond this a heartbeat describes a closed app, not a live tracker. */
export const FRESH_HEARTBEAT_MS = 15 * 60_000;

/** No native location callback for this long, while tracking is ON. */
export const CALLBACK_STALL_S = 1800;

export type DeviceSignals = {
  /** The driver's own toggle. Null/false means they chose to stop. */
  trackingEnabled: boolean | null;
  /** Seconds since the last native location callback. */
  lastCbAgeS: number | null;
  /** "always" | "whenInUse" | ... as the OS reports it. */
  locationAuthorization: string | null;
  /** summarizeForHeartbeat() output: "ok" | "dead=a,b" | "degraded=x" ... */
  selfCheck: string | null;
  /** When this heartbeat was written, epoch ms. */
  reportedAtMs: number | null;
};

export type StallReason =
  | "callback_stalled"
  | "authorization_downgraded"
  | "capability_dead";

export type StallVerdict = {
  stalled: boolean;
  reasons: StallReason[];
  /** One line naming what to chase, for the alert body and the log. */
  detail: string;
};

/**
 * Judge a single device.
 *
 * `nowMs` is passed in rather than read from Date.now() so the freshness
 * rule is testable and a single cron pass cannot disagree with itself.
 */
export function evaluateDeviceStall(
  s: DeviceSignals,
  nowMs: number,
): StallVerdict {
  const none: StallVerdict = { stalled: false, reasons: [], detail: "" };

  // A driver who turned tracking off is not a fault. Alarming on their
  // own choice is the fastest way to teach someone to ignore us.
  if (s.trackingEnabled !== true) return none;

  // A stale heartbeat means the app is closed, which the separate
  // GPS-silence alarm owns. Judging device truth from a stale row would
  // fire this alarm every night on a phone that is simply asleep.
  if (s.reportedAtMs == null || nowMs - s.reportedAtMs >= FRESH_HEARTBEAT_MS) {
    return none;
  }

  const reasons: StallReason[] = [];
  const details: string[] = [];

  if (s.lastCbAgeS != null && s.lastCbAgeS > CALLBACK_STALL_S) {
    reasons.push("callback_stalled");
    details.push(
      `no location callback for ${Math.round(s.lastCbAgeS / 60)} min while tracking is on`,
    );
  }

  if (s.locationAuthorization != null && s.locationAuthorization !== "always") {
    reasons.push("authorization_downgraded");
    details.push(`location permission is "${s.locationAuthorization}", not Always`);
  }

  // The new one. Only `dead=`: see the module comment for why `degraded=`
  // is deliberately not an escalation.
  if (s.selfCheck != null && s.selfCheck.startsWith("dead=")) {
    const names = s.selfCheck.slice("dead=".length);
    reasons.push("capability_dead");
    details.push(`shipped capabilities not answering: ${names}`);
  }

  if (reasons.length === 0) return none;
  return { stalled: true, reasons, detail: details.join("; ") };
}
