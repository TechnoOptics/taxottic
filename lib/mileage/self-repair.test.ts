import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { evaluate, type ProbeInput } from "./self-check";
import {
  GEOFENCE_REARM_BACKOFF_MS,
  MAX_REPAIR_ATTEMPTS,
  PROMPT_EVERY_MS,
  repairableFaults,
  runSelfRepairs,
  type RepairId,
  type RepairLedger,
} from "./self-repair";

/**
 * Step B of docs/design/self-healing-capture.md: the self-check stops
 * reporting and starts acting, for the two verdicts a device can
 * genuinely repair on its own.
 *
 * Every boundary asserted here is a boundary the design doc drew, and
 * most of them are the difference between a repair and a repair LOOP.
 * The hazard is not that a repair fails, it is that it retries forever:
 * a supervisor that restarts a service which immediately dies burns
 * battery and manufactures exactly the noise it exists to remove.
 */

const androidBase: ProbeInput = {
  platform: "android",
  probed: true,
  deviceStatusOk: true,
  deviceStatusMs: 12,
  deviceStatusStage: "done",
  geofenceArmState: "armed",
  geofenceCount: 4,
  locationAuthorization: "always",
  lowPowerMode: false,
  bluetoothPermission: "granted",
  bluetoothPermissionAsked: true,
  carSignalsOk: true,
};

/** Grace's iPhone: every plugin compiled, none registered. */
const deadPlugins: ProbeInput = {
  ...androidBase,
  platform: "ios",
  deviceStatusOk: false,
  deviceStatusMs: 1,
  deviceStatusStage: "call",
  geofenceArmState: null,
  geofenceCount: null,
  locationAuthorization: null,
  lowPowerMode: null,
};

const faultsOf = (p: ProbeInput): RepairId[] =>
  repairableFaults(evaluate(p), { locationAuthorization: p.locationAuthorization });

/** A recorder standing in for the real bridge calls. */
function spyExec(results: Partial<Record<RepairId, boolean>> = {}) {
  const calls: RepairId[] = [];
  return {
    calls,
    exec: {
      geofence_armed: async () => {
        calls.push("geofence_armed");
        return results.geofence_armed ?? true;
      },
      location_always: async () => {
        calls.push("location_always");
        return results.location_always ?? true;
      },
    },
  };
}

/** Drive one pass and hand back everything a caller can observe. */
async function pass(
  p: ProbeInput,
  opts: {
    ledger?: RepairLedger;
    nowMs?: number;
    driving?: boolean;
    results?: Partial<Record<RepairId, boolean>>;
  } = {},
) {
  const spy = spyExec(opts.results);
  let saved: RepairLedger = opts.ledger ?? {};
  const out = await runSelfRepairs(evaluate(p), {
    nowMs: opts.nowMs ?? 1_000_000,
    driving: opts.driving ?? false,
    locationAuthorization: p.locationAuthorization,
    ledger: saved,
    exec: spy.exec,
    save: (l) => {
      saved = l;
    },
  });
  return { ...out, calls: spy.calls, ledger: saved };
}

describe("what is repairable, and what is deliberately not", () => {
  it("does not touch a healthy device", async () => {
    expect(faultsOf(androidBase)).toEqual([]);
    const r = await pass(androidBase);
    expect(r.calls).toEqual([]);
    expect(r.summary).toBe("none");
  });

  it("re-arms a geofence mesh whose registration failed", async () => {
    // The one arm state that is genuinely our failure and genuinely
    // retryable: Play services refused the registration, and a resync
    // is the same call that would have worked.
    const p = { ...androidBase, geofenceArmState: "disarmed_registration_failed" };
    expect(faultsOf(p)).toEqual(["geofence_armed"]);
    const r = await pass(p);
    expect(r.calls).toEqual(["geofence_armed"]);
    expect(r.summary).toBe("geofence_armed:ok");
  });

  it("NEVER repairs disarmed_no_places: it is not a fault", async () => {
    // A device with nothing to arm is working correctly and has nothing
    // to do. Repairing it would resync an empty list on every beat, for
    // the entire onboarding period of every new driver.
    const p = { ...androidBase, geofenceArmState: "disarmed_no_places" };
    expect(faultsOf(p)).toEqual([]);
    expect((await pass(p)).calls).toEqual([]);
  });

  it("does not re-arm when the permission is the reason it is disarmed", async () => {
    // disarmed_no_background_permission is `denied`, the driver's
    // setting. Re-registering geofences cannot succeed without the
    // permission, so a retry is a guaranteed-failing loop.
    const p = {
      ...androidBase,
      geofenceArmState: "disarmed_no_background_permission",
      locationAuthorization: "whenInUse",
    };
    expect(faultsOf(p)).not.toContain("geofence_armed");
  });

  it("does not try to repair a dead plugin", async () => {
    // No on-device action fixes an unregistered plugin; it needs a store
    // build. Attempting it would spend the attempt cap on the one
    // failure that provably cannot be healed from here.
    expect(faultsOf(deadPlugins)).toEqual([]);
    const r = await pass(deadPlugins);
    expect(r.calls).toEqual([]);
  });

  it("re-prompts for Always when the OS can still show a prompt", async () => {
    const p = { ...androidBase, locationAuthorization: "whenInUse" };
    expect(faultsOf(p)).toEqual(["location_always"]);
    const r = await pass(p);
    expect(r.calls).toEqual(["location_always"]);
    // Never "ok": the request opens a dialog and the answer is the
    // driver's, minutes later. Claiming success here would report a
    // repair that has not happened.
    expect(r.summary).toBe("location_always:prompted");
  });

  it("prompts once from notDetermined", async () => {
    const p = { ...androidBase, locationAuthorization: "notDetermined" };
    expect(faultsOf(p)).toEqual(["location_always"]);
  });

  it("does NOT re-prompt a driver who already refused", async () => {
    // iOS silently discards requestAlwaysAuthorization once the user has
    // declined, and Android does the same after "don't ask again". The
    // call cannot produce a dialog, so it can only burn the attempt cap
    // and make the ledger claim we asked when nobody was asked.
    const p = { ...androidBase, locationAuthorization: "denied" };
    expect(faultsOf(p)).toEqual([]);
    expect((await pass(p)).calls).toEqual([]);
  });
});

describe("the attempt cap, which is what stops a repair becoming a loop", () => {
  const broken = { ...androidBase, geofenceArmState: "disarmed_registration_failed" };

  /** Run n passes far enough apart that backoff never blocks. */
  async function repeat(n: number, from = 1_000_000) {
    let ledger: RepairLedger = {};
    let last!: Awaited<ReturnType<typeof pass>>;
    let t = from;
    for (let i = 0; i < n; i++) {
      last = await pass(broken, { ledger, nowMs: t });
      ledger = last.ledger;
      t += PROMPT_EVERY_MS * 2; // beyond any backoff this module uses
    }
    return { last, ledger };
  }

  it("stops after MAX_REPAIR_ATTEMPTS against a fault that will not clear", async () => {
    const { last } = await repeat(MAX_REPAIR_ATTEMPTS + 2);
    expect(last.calls).toEqual([]);
  });

  it("makes the cap observable rather than silent", async () => {
    // A supervisor that has given up must SAY it has given up. Silence
    // here is indistinguishable from a healthy device.
    const { last } = await repeat(MAX_REPAIR_ATTEMPTS + 1);
    expect(last.summary).toBe("geofence_armed:capped");
  });

  it("counts every attempt this install has ever made", async () => {
    const { last } = await repeat(MAX_REPAIR_ATTEMPTS + 3);
    expect(last.attempts).toBe(MAX_REPAIR_ATTEMPTS);
  });

  it("backs off further after each failed attempt", async () => {
    const first = await pass(broken, { nowMs: 1_000_000 });
    expect(first.calls).toEqual(["geofence_armed"]);
    // One backoff period after the first attempt is NOT enough: the
    // second wait is twice the first.
    const tooSoon = await pass(broken, {
      ledger: first.ledger,
      nowMs: 1_000_000 + GEOFENCE_REARM_BACKOFF_MS + 1,
    });
    expect(tooSoon.calls).toEqual([]);
    expect(tooSoon.summary).toBe("geofence_armed:waiting");
    const later = await pass(broken, {
      ledger: first.ledger,
      nowMs: 1_000_000 + GEOFENCE_REARM_BACKOFF_MS * 2 + 1,
    });
    expect(later.calls).toEqual(["geofence_armed"]);
  });

  it("asks for a permission at most once a week", async () => {
    const p = { ...androidBase, locationAuthorization: "whenInUse" };
    const first = await pass(p, { nowMs: 1_000_000 });
    expect(first.calls).toEqual(["location_always"]);
    const nextDay = await pass(p, {
      ledger: first.ledger,
      nowMs: 1_000_000 + 24 * 60 * 60_000,
    });
    expect(nextDay.calls).toEqual([]);
    const nextWeek = await pass(p, {
      ledger: first.ledger,
      nowMs: 1_000_000 + PROMPT_EVERY_MS + 1,
    });
    expect(nextWeek.calls).toEqual(["location_always"]);
  });

  it("records a failed repair as failed, and still counts it", async () => {
    const r = await pass(broken, { results: { geofence_armed: false } });
    expect(r.summary).toBe("geofence_armed:failed");
    expect(r.attempts).toBe(1);
  });
});

describe("proving a repair actually worked", () => {
  const broken = { ...androidBase, geofenceArmState: "disarmed_registration_failed" };

  it("reports healed on the first pass where the fault is gone", async () => {
    // The whole observability story. Without this, a successful repair
    // and a device that never had a fault are the same row.
    const attempted = await pass(broken, { nowMs: 1_000_000 });
    const after = await pass(androidBase, {
      ledger: attempted.ledger,
      nowMs: 2_000_000,
    });
    expect(after.summary).toBe("geofence_armed:healed");
  });

  it("re-arms the repairer once the fault has cleared", async () => {
    // A transient Play-services failure months later deserves a fresh
    // set of attempts. A permanent cap would make the first bad week of
    // a device's life disable the repair for its whole life.
    let ledger: RepairLedger = {};
    let t = 1_000_000;
    for (let i = 0; i < MAX_REPAIR_ATTEMPTS; i++) {
      ledger = (await pass(broken, { ledger, nowMs: t })).ledger;
      t += PROMPT_EVERY_MS * 2;
    }
    expect((await pass(broken, { ledger, nowMs: t })).calls).toEqual([]);
    const healed = await pass(androidBase, { ledger, nowMs: t });
    const again = await pass(broken, { ledger: healed.ledger, nowMs: t + 1 });
    expect(again.calls).toEqual(["geofence_armed"]);
  });

  it("keeps the lifetime attempt count across a heal", async () => {
    const one = await pass(broken, { nowMs: 1_000_000 });
    const healed = await pass(androidBase, { ledger: one.ledger, nowMs: 2_000_000 });
    const two = await pass(broken, { ledger: healed.ledger, nowMs: 3_000_000 });
    expect(two.attempts).toBe(2);
  });
});

describe("a repair must never disturb a drive in progress", () => {
  const broken = { ...androidBase, geofenceArmState: "disarmed_registration_failed" };

  it("stands down while the vehicle is moving", async () => {
    // Two reasons, and either alone is sufficient. Re-registering the
    // mesh mid-drive touches the capture path while points are being
    // taken, and the never-shrink invariant means a drive that loses
    // fixes cannot be repaired later. An OS permission dialog raised at
    // the wheel is worse: it is unsafe, it will be dismissed, and the
    // dismissal spends one of a finite number of prompts.
    const r = await pass(broken, { driving: true });
    expect(r.calls).toEqual([]);
    expect(r.summary).toBe("geofence_armed:driving");
  });

  it("does not spend an attempt on a pass it stood down from", async () => {
    const r = await pass(broken, { driving: true });
    expect(r.attempts).toBe(0);
    const after = await pass(broken, { ledger: r.ledger, nowMs: 1_000_001 });
    expect(after.calls).toEqual(["geofence_armed"]);
  });
});

/**
 * THE WIRING, not the module.
 *
 * self-check.ts was correct and inert for weeks because the caller fed
 * it a platform derived from a dead plugin. The same shape would make
 * this module worse than useless: a repairer that is never invoked, or
 * invoked with a `driving` flag pinned to false, reports healthy while
 * repairing nothing. Only the call site can catch that.
 */
const TRACKER = "lib/mileage/native-tracker.ts";
const HEARTBEAT_ROUTE = "app/api/mileage/heartbeat/route.ts";

/** Comments have shipped as fake evidence here three times. Strip them. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

describe("the tracker actually runs the repairs", () => {
  it("calls the repairer from the heartbeat", () => {
    expect(code(TRACKER)).toContain("runSelfRepairs(");
  });

  it("repairs from the SAME verdicts it reports", () => {
    // Two evaluations would be two sources of truth, and the one that
    // disagreed would be the one nobody read.
    const src = code(TRACKER);
    expect(src.match(/evaluateSelfCheck\(/g)?.length).toBe(1);
    expect(src).toMatch(/summarizeForHeartbeat\(\s*selfCheckChecks\s*\)/);
    expect(src).toMatch(/runSelfRepairs\(\s*selfCheckChecks/);
  });

  it("sends the repair outcome and the attempt count on the heartbeat", () => {
    const src = code(TRACKER);
    expect(src).toContain("selfRepair:");
    expect(src).toContain("selfRepairAttempts:");
  });

  it("feeds the driving gate from real drive state, never a literal", () => {
    // `driving: false` would silently delete the whole standing-down
    // rule while every test above kept passing.
    const src = code(TRACKER);
    const call = src.slice(src.indexOf("runSelfRepairs("));
    const block = call.slice(0, call.indexOf(");"));
    expect(block).not.toMatch(/driving:\s*(false|true)\b/);
    expect(block).toContain("deLastMovingTs");
  });

  it("stores both new columns from the heartbeat route", () => {
    const src = code(HEARTBEAT_ROUTE);
    expect(src).toContain("self_repair:");
    expect(src).toContain("self_repair_attempts:");
  });
});
