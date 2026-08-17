/**
 * The self-check stops reporting and starts acting.
 *
 * Step B of docs/design/self-healing-capture.md. Step A taught the
 * finalize cron to escalate on a `dead=` verdict, which closed the
 * nine-day gap between the system knowing something was broken and a
 * human running the query that said so. Noticing is not repairing, and
 * two of the verdicts ./self-check.ts produces describe faults the
 * device can genuinely fix by itself.
 *
 * WHAT IS REPAIRED HERE, AND ONLY THIS
 *
 *   geofence_armed = dead     The learned-place mesh failed to register.
 *                             The fix is the same syncPlaces call that
 *                             failed, and Play services refusing once
 *                             does not mean it will refuse again.
 *
 *   location_always = denied  And the OS can still raise a dialog. A
 *                             re-request is the only action that can
 *                             change the answer.
 *
 * WHAT IS DELIBERATELY NOT REPAIRED, each for a reason that has already
 * cost time here:
 *
 *   device_status_plugin / geofence_plugin = dead
 *       An unregistered plugin needs a store build. Capacitor 8 loads
 *       only packageClassList, and nothing running inside the app can
 *       add to it. Retrying would spend the attempt budget on the one
 *       failure provably unfixable from the device.
 *
 *   geofence arm state disarmed_no_places
 *       NOT A FAULT. self-check calls it `live` on purpose: a device
 *       with nothing to arm is working correctly. Repairing it would
 *       resync an empty list on every heartbeat for the whole
 *       onboarding period of every new driver.
 *
 *   geofence arm state disarmed_no_background_permission
 *       `denied`, not `dead`. Re-registering geofences without the
 *       permission is a guaranteed-failing call, which is the exact
 *       shape of a repair loop.
 *
 *   locationAuthorization "denied" / "restricted"
 *       iOS silently discards requestAlwaysAuthorization once the user
 *       has declined, and Android does the same after "don't ask
 *       again". The call cannot produce a dialog, so it would only make
 *       the ledger claim we asked when nobody was asked.
 *
 *   low_power_mode = degraded
 *       Nothing on this side can turn off the driver's battery setting.
 *       That verdict is the driver's to see and act on, not ours.
 *
 * WHY A LEDGER RATHER THAN A RETRY
 *
 * The design doc names the hazard exactly: "a supervisor that restarts
 * a service which immediately dies burns battery and generates the
 * noise it exists to remove". So every repair is bounded three ways.
 *
 *   Capped.     MAX_REPAIR_ATTEMPTS consecutive attempts against a
 *               fault that never clears, then it stops and SAYS it
 *               stopped. A silent surrender is indistinguishable from a
 *               healthy device.
 *   Backed off. Each further attempt waits longer than the last, and a
 *               permission prompt waits a week regardless.
 *   Re-armable. The count resets when the fault clears, so a transient
 *               failure a year from now still gets repaired. A
 *               permanent cap would let one bad week disable the
 *               repairer for the life of the install.
 *
 * WALL CLOCK, NOT TIMERS
 *
 * Nothing here schedules anything. It is called from the heartbeat,
 * which is driven by ingest and therefore rides the location callbacks
 * that keep firing while a backgrounded WebView's setInterval is frozen
 * (measured `timer_lag_ms`: fifteen hours). Every gate below compares
 * `nowMs` against a stored wall-clock stamp, so a pass that arrives
 * hours late behaves correctly rather than firing a queue of repairs.
 * Same rule, same reason, as ./native-drain.ts.
 */

import { syncLearnedPlaces } from "./geofence";
import { requestAlwaysUpgrade } from "./device-status";
import type { CapabilityCheck } from "./self-check";

/** The only two verdicts a device can act on by itself. */
export type RepairId = "geofence_armed" | "location_always";

/** Fixed order, so one device's summary can be diffed against another's. */
const REPAIR_ORDER: readonly RepairId[] = ["geofence_armed", "location_always"];

/**
 * Consecutive attempts against a fault that is still there, then stop.
 *
 * Three because the failure this bounds is "the call does not work on
 * this device", and three refusals is enough evidence. It is not a
 * lifetime budget: the counter resets the moment the fault clears.
 */
export const MAX_REPAIR_ATTEMPTS = 3;

/**
 * First wait before a geofence re-arm, doubling per further attempt, so
 * 15 / 30 / 60 minutes. Longer than the 5-minute heartbeat on purpose:
 * a repair on every beat is a loop with extra steps.
 */
export const GEOFENCE_REARM_BACKOFF_MS = 15 * 60_000;

/**
 * A permission prompt is a driver-facing interruption, so it is rationed
 * by the calendar rather than by backoff. Once a week, three times, then
 * never again until the setting changes on its own. iOS also grants a
 * finite number of Always upgrade prompts per install, which is a hard
 * reason not to spend them faster than this.
 */
export const PROMPT_EVERY_MS = 7 * 24 * 60 * 60_000;

/**
 * Authorization states from which a request can still put a dialog on
 * screen. Anything else means the OS will discard the call in silence.
 */
export const PROMPTABLE_AUTHORIZATIONS: readonly string[] = [
  "notDetermined",
  "whenInUse",
];

/** Per-fault state, deleted the moment that fault clears. */
type OpenRepair = { attempts: number; lastAtMs: number };

export type RepairLedger = {
  /** Faults currently being worked on. */
  open?: Partial<Record<RepairId, OpenRepair>>;
  /**
   * Attempts this install has ever made, per id, never reset.
   *
   * Separate from `open` precisely because `open` is cleared on a heal.
   * Without this, a device that repaired itself successfully reports the
   * same zero as a device that never tried, and "did the repair ever
   * run" becomes unanswerable from the data.
   */
  lifetime?: Partial<Record<RepairId, number>>;
};

/** What a repair executor did. Injected so the decision is testable. */
export type RepairExecutors = Record<RepairId, () => Promise<boolean>>;

/**
 * Faults present RIGHT NOW that this module is willing to act on.
 *
 * Reads the verdicts rather than re-deriving them from raw device state.
 * A second derivation would be a second source of truth, and the one
 * that disagreed would be the one nobody read. `locationAuthorization`
 * is passed alongside for one narrow question the verdict cannot answer:
 * `denied` covers both "the driver chose While Using" and "the driver
 * refused outright", and only the first can still be prompted.
 */
export function repairableFaults(
  checks: CapabilityCheck[],
  os: { locationAuthorization: string | null },
): RepairId[] {
  const verdict = (id: string) => checks.find((c) => c.id === id)?.verdict;
  const out: RepairId[] = [];
  if (verdict("geofence_armed") === "dead") out.push("geofence_armed");
  if (
    verdict("location_always") === "denied" &&
    os.locationAuthorization != null &&
    PROMPTABLE_AUTHORIZATIONS.includes(os.locationAuthorization)
  ) {
    out.push("location_always");
  }
  return out;
}

/** Wall clock that must pass before attempt number `attempts` + 1. */
export function backoffMs(id: RepairId, attempts: number): number {
  return id === "location_always"
    ? PROMPT_EVERY_MS
    : GEOFENCE_REARM_BACKOFF_MS * 2 ** attempts;
}

export type RepairRunOptions = {
  nowMs: number;
  /** True while a drive is in flight. See the standing-down rule below. */
  driving: boolean;
  locationAuthorization: string | null;
  ledger: RepairLedger;
  exec: RepairExecutors;
  save: (ledger: RepairLedger) => void;
};

/**
 * One pass. Repairs what is eligible, records what it did, and returns
 * the two things the heartbeat carries.
 *
 * `summary` is one segment per id in a non-idle state, `<id>:<state>`,
 * or "none". The vocabulary, worst understanding first:
 *
 *   capped    the fault is still here and we have given up on it
 *   waiting   the fault is still here, backoff has not elapsed
 *   driving   the fault is still here, we stood down for a live drive
 *   failed    the repair ran this pass and reported failure
 *   ok        the repair ran this pass and reported success
 *   prompted  a permission dialog was raised; the answer is the
 *             driver's, minutes from now, so success cannot be claimed
 *   healed    the fault we had been repairing is GONE. The only row
 *             that proves a repair worked, and the reason `open` is
 *             read before it is cleared.
 */
export async function runSelfRepairs(
  checks: CapabilityCheck[],
  opts: RepairRunOptions,
): Promise<{ summary: string; attempts: number }> {
  const faults = new Set(
    repairableFaults(checks, {
      locationAuthorization: opts.locationAuthorization,
    }),
  );
  const open: Partial<Record<RepairId, OpenRepair>> = {
    ...(opts.ledger.open ?? {}),
  };
  const lifetime: Partial<Record<RepairId, number>> = {
    ...(opts.ledger.lifetime ?? {}),
  };
  const states: string[] = [];

  for (const id of REPAIR_ORDER) {
    const entry = open[id];

    if (!faults.has(id)) {
      // Absence of the fault is the success signal, and it is also what
      // re-arms the repairer for a recurrence months from now.
      if (entry) {
        delete open[id];
        states.push(`${id}:healed`);
      }
      continue;
    }

    // A DRIVE IN PROGRESS OUTRANKS EVERY REPAIR.
    //
    // Re-registering the mesh touches the capture path while fixes are
    // being taken, and a drive that loses points cannot be repaired
    // afterwards: the rendered track never shrinks, so a hole is
    // permanent. An OS permission dialog raised at the wheel is worse
    // still, because it is unsafe, it will be dismissed, and the
    // dismissal spends one of a finite number of prompts.
    //
    // Deliberately not counted as an attempt. Standing down is not a
    // try, and charging the cap for it would let a long drive exhaust
    // the budget without a single repair ever being made.
    if (opts.driving) {
      states.push(`${id}:driving`);
      continue;
    }

    const attempts = entry?.attempts ?? 0;
    if (attempts >= MAX_REPAIR_ATTEMPTS) {
      states.push(`${id}:capped`);
      continue;
    }

    const lastAtMs = entry?.lastAtMs ?? 0;
    if (lastAtMs > 0 && opts.nowMs - lastAtMs < backoffMs(id, attempts)) {
      states.push(`${id}:waiting`);
      continue;
    }

    // Stamped BEFORE the call, like the heartbeat's own lastBeatAt. A
    // repair that hangs on the bridge must not let the next pass start
    // a second one behind it.
    open[id] = { attempts: attempts + 1, lastAtMs: opts.nowMs };
    lifetime[id] = (lifetime[id] ?? 0) + 1;
    let ok = false;
    try {
      ok = await opts.exec[id]();
    } catch {
      ok = false;
    }
    states.push(
      `${id}:${ok ? (id === "location_always" ? "prompted" : "ok") : "failed"}`,
    );
  }

  opts.save({ open, lifetime });
  return {
    summary: states.length > 0 ? states.join(",") : "none",
    attempts: REPAIR_ORDER.reduce((n, id) => n + (lifetime[id] ?? 0), 0),
  };
}

const LS_REPAIR = "taxottic.mileage.repair";

/**
 * The ledger lives in localStorage, not on a module object.
 *
 * Module state is erased by every reload, and on this app a reload
 * happens whenever the service worker takes over. A cap that resets on
 * each reload is not a cap, and the device would repair on a loop while
 * every counter kept reading 1.
 */
export function readRepairLedger(): RepairLedger {
  try {
    const raw = window.localStorage.getItem(LS_REPAIR);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as RepairLedger;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeRepairLedger(ledger: RepairLedger): void {
  try {
    window.localStorage.setItem(LS_REPAIR, JSON.stringify(ledger));
  } catch {
    /* private mode: the cap degrades to per-page-life, never to none */
  }
}

/**
 * A repair runs inside the heartbeat, so it must not be able to hold the
 * heartbeat up. A wedged bridge or a hanging fetch is exactly the
 * condition a broken device is in, and a health report that never sends
 * because the repair for the fault is stuck is the worst possible trade.
 */
const REPAIR_TIMEOUT_MS = 5_000;

function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p.catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ]);
}

/**
 * The real bridge calls, one per repairable verdict.
 *
 * Both report whether the repair DEMONSTRABLY worked rather than whether
 * the call returned. syncLearnedPlaces answers with the arm state the
 * native side reached, so "armed" is evidence and anything else is a
 * failed attempt that should count against the cap.
 */
export function nativeRepairs(companyId: string): RepairExecutors {
  return {
    geofence_armed: async () => {
      const r = await within(syncLearnedPlaces(companyId), REPAIR_TIMEOUT_MS);
      return r?.armState === "armed";
    },
    location_always: async () => {
      // Returns void: the dialog is raised, and the driver answers it
      // whenever they answer it. `true` here means "asked", which is
      // why this id reports `prompted` and never `ok`.
      await within(requestAlwaysUpgrade(), REPAIR_TIMEOUT_MS);
      return true;
    },
  };
}
