import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  evaluateDeviceStall,
  FRESH_HEARTBEAT_MS,
  CALLBACK_STALL_S,
  type DeviceSignals,
} from "./device-stall";

const NOW = 1_760_000_000_000;

/** A device doing exactly what it should. */
const healthy: DeviceSignals = {
  trackingEnabled: true,
  lastCbAgeS: 12,
  locationAuthorization: "always",
  selfCheck: "ok",
  reportedAtMs: NOW - 60_000,
};

describe("what must escalate", () => {
  it("a dead capability, which is the case that cost nine days", () => {
    // Grace's iPhone wrote exactly this string into every heartbeat while
    // nothing read it. push_registration_state separately held the cause
    // of a dead push subsystem for nine days, naming the entitlement.
    const p = {
      ...healthy,
      selfCheck: "dead=device_status_plugin,geofence_plugin",
    };
    const v = evaluateDeviceStall(p, NOW);
    expect(v.stalled).toBe(true);
    expect(v.reasons).toContain("capability_dead");
  });

  it("names the dead capabilities, so the alert is actionable", () => {
    const v = evaluateDeviceStall(
      { ...healthy, selfCheck: "dead=geofence_plugin" },
      NOW,
    );
    // A count says something is wrong; a name says what to fix.
    expect(v.detail).toContain("geofence_plugin");
  });

  it("a stalled location callback", () => {
    const v = evaluateDeviceStall(
      { ...healthy, lastCbAgeS: CALLBACK_STALL_S + 1 },
      NOW,
    );
    expect(v.reasons).toEqual(["callback_stalled"]);
  });

  it("a downgraded authorization", () => {
    const v = evaluateDeviceStall(
      { ...healthy, locationAuthorization: "whenInUse" },
      NOW,
    );
    expect(v.reasons).toEqual(["authorization_downgraded"]);
  });

  it("reports EVERY reason, not the first", () => {
    // A phone can be broken in more than one way, and reporting one hides
    // the others. That is the failure mode this whole area exists to end.
    const v = evaluateDeviceStall(
      {
        ...healthy,
        lastCbAgeS: 9999,
        locationAuthorization: "whenInUse",
        selfCheck: "dead=geofence_plugin",
      },
      NOW,
    );
    expect(v.reasons.sort()).toEqual([
      "authorization_downgraded",
      "callback_stalled",
      "capability_dead",
    ]);
  });
});

describe("what must NOT escalate, or the alarm gets muted", () => {
  it("a healthy device", () => {
    expect(evaluateDeviceStall(healthy, NOW).stalled).toBe(false);
  });

  it("DEGRADED is not an escalation: it is the driver's own setting", () => {
    // Low Power Mode is real and worth showing IN THE APP, but it is not
    // "we shipped something broken". Routing both through one alarm is
    // how an alarm becomes noise. Grace's phone reports exactly this
    // string right now, and it must not page anyone.
    const v = evaluateDeviceStall(
      { ...healthy, selfCheck: "degraded=low_power_mode" },
      NOW,
    );
    expect(v.stalled).toBe(false);
  });

  it("UNKNOWN is not an escalation either", () => {
    // Not measured yet. Alarming on the absence of a measurement fires on
    // every cold start.
    const v = evaluateDeviceStall(
      { ...healthy, selfCheck: "unknown=car_signals_plugin" },
      NOW,
    );
    expect(v.stalled).toBe(false);
  });

  it("a driver who turned tracking OFF is exercising a choice", () => {
    const v = evaluateDeviceStall(
      { ...healthy, trackingEnabled: false, selfCheck: "dead=geofence_plugin" },
      NOW,
    );
    expect(v.stalled).toBe(false);
  });

  it("a STALE heartbeat means the app is closed, not that we are broken", () => {
    // Judging device truth from a stale row would fire this every night
    // on a phone that is merely asleep. The GPS-silence alarm owns that.
    const v = evaluateDeviceStall(
      {
        ...healthy,
        selfCheck: "dead=geofence_plugin",
        reportedAtMs: NOW - FRESH_HEARTBEAT_MS,
      },
      NOW,
    );
    expect(v.stalled).toBe(false);
  });

  it("a null heartbeat time is treated as stale, not as fresh", () => {
    const v = evaluateDeviceStall(
      { ...healthy, selfCheck: "dead=x", reportedAtMs: null },
      NOW,
    );
    expect(v.stalled).toBe(false);
  });

  it("null authorization is unknown, not a downgrade", () => {
    // Before the iOS plugin fix this was null on every iPhone. Treating
    // null as "not Always" would have accused every driver of declining a
    // permission they had actually granted, which is the precise mistake
    // that blamed a driver for our bug.
    const v = evaluateDeviceStall(
      { ...healthy, locationAuthorization: null },
      NOW,
    );
    expect(v.stalled).toBe(false);
  });
});

/**
 * Call-site guard. The predicate is worthless if the cron keeps its own
 * inline copy, which is how this logic went untested in the first place.
 */
describe("the finalize cron uses this predicate", () => {
  const ROUTE = "app/api/cron/mileage-finalize/route.ts";
  const src = readFileSync(ROUTE, "utf8");

  it("calls evaluateDeviceStall", () => {
    expect(src).toContain("evaluateDeviceStall(");
  });

  it("selects self_check, or the new rule can never fire", () => {
    // The rule is only as good as the column feeding it. Omitting
    // self_check from the SELECT leaves it permanently null and the
    // escalation permanently silent.
    //
    // THE FIRST VERSION OF THIS TEST DID NOT CATCH THAT. It matched
    // /self_check/ against the whole file, and the route carries a
    // COMMENT explaining why self_check matters, so deleting the column
    // from the actual SELECT left the test green. Prose satisfied a guard
    // meant to check code, for the second time in one session.
    //
    // Assert on the select() argument itself, comments stripped.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    const i = code.indexOf("mileage_device_status");
    const selectArg = code.slice(i, code.indexOf(".maybeSingle()", i));
    expect(selectArg).toContain("self_check");
  });

  it("keeps no inline copy of the thresholds", () => {
    expect(src).not.toMatch(/cbAge\s*!=\s*null\s*&&\s*cbAge\s*>\s*1800/);
  });
});
