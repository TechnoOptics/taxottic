import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  UNREGISTERED_MS_CEILING,
  deadCapabilities,
  describe as describeChecks,
  evaluate,
  summarizeForHeartbeat,
  type ProbeInput,
} from "./self-check";

/**
 * Every case below is a real production state from 2026-08-15, not a
 * hypothetical. The module exists because three separate features were
 * BUILT BUT DEAD and every one of them reported as a null column, which
 * reads as "no data yet" and gets skipped rather than chased.
 *
 * The assertions that matter most are the ones separating:
 *
 *   dead     we shipped it and it will not answer      OUR bug
 *   denied   the driver said no                        their choice
 *   unknown  we could not tell                         honest, not an alarm
 *
 * Collapsing any two of those is how the original bugs stayed invisible.
 */

const web: ProbeInput = {
  platform: "web",
  probed: true,
  deviceStatusOk: null, deviceStatusMs: null, deviceStatusStage: null,
  geofenceArmState: null, geofenceCount: null,
  locationAuthorization: null,
  lowPowerMode: null,
  bluetoothPermission: null, bluetoothPermissionAsked: null, carSignalsOk: null,
};

/** Grace's iPhone: every plugin compiled, none registered. */
const graceIos: ProbeInput = {
  ...web,
  platform: "ios",
  deviceStatusOk: false, deviceStatusMs: 1, deviceStatusStage: "call",
};

/** Abel's Android before the Bluetooth prompt was wired. */
const abelAndroid: ProbeInput = {
  ...web,
  platform: "android",
  deviceStatusOk: true, deviceStatusMs: 12, deviceStatusStage: "done",
  geofenceArmState: "armed", geofenceCount: 4,
  locationAuthorization: "always",
  // A device whose plugin ANSWERS reports this. Leaving it null here
  // would model a state this device cannot be in, and the fixture that
  // modelled an impossible state is exactly what let the platform bug
  // survive 21 passing tests.
  lowPowerMode: false,
  bluetoothPermission: "not_requested", bluetoothPermissionAsked: false,
  carSignalsOk: true,
};

const verdictOf = (p: ProbeInput, id: string) =>
  evaluate(p).find((c) => c.id === id)?.verdict;

describe("the iPhone that reported nothing for weeks", () => {
  it("calls the device-status plugin DEAD, not unknown", () => {
    // The whole point. This was a null column for the life of the
    // feature, and a null reads as "not measured yet".
    expect(verdictOf(graceIos, "device_status_plugin")).toBe("dead");
  });

  it("names the registration failure in the detail", () => {
    const c = evaluate(graceIos).find((x) => x.id === "device_status_plugin")!;
    expect(c.detail).toMatch(/not registered/i);
    expect(c.detail).toContain("1ms");
  });

  it("calls a silent geofence plugin DEAD", () => {
    expect(verdictOf(graceIos, "geofence_plugin")).toBe("dead");
  });

  it("does NOT blame the driver for an unreadable location setting", () => {
    // This is the mistake that cost weeks: a null authorization was read
    // as "she has not granted Always", when in fact the plugin that
    // reports it was dead. Blaming the user hides our bug.
    expect(verdictOf(graceIos, "location_always")).toBe("unknown");
    const c = evaluate(graceIos).find((x) => x.id === "location_always")!;
    expect(c.detail).toMatch(/not that the driver declined/i);
  });

  it("summarises by NAME so the row is actionable", () => {
    const s = summarizeForHeartbeat(evaluate(graceIos));
    expect(s).toMatch(/^dead=/);
    expect(s).toContain("device_status_plugin");
    expect(s).toContain("geofence_plugin");
  });
});

describe("the Android that looked completely healthy", () => {
  it("still catches the Bluetooth prompt that was never shown", () => {
    // Everything else on this device was green. The one broken thing was
    // invisible precisely because "not_requested" looks like a user
    // choice unless you also know we never asked.
    expect(verdictOf(abelAndroid, "bluetooth_permission")).toBe("dead");
  });

  it("says never offered, not declined", () => {
    const c = evaluate(abelAndroid).find((x) => x.id === "bluetooth_permission")!;
    expect(c.detail).toMatch(/never been shown|never offered/i);
  });

  it("reports the genuinely working parts as live", () => {
    expect(verdictOf(abelAndroid, "device_status_plugin")).toBe("live");
    expect(verdictOf(abelAndroid, "geofence_armed")).toBe("live");
    expect(verdictOf(abelAndroid, "location_always")).toBe("live");
  });

  it("goes clean once the permission is granted", () => {
    const fixed = { ...abelAndroid, bluetoothPermission: "granted", bluetoothPermissionAsked: true };
    expect(summarizeForHeartbeat(evaluate(fixed))).toBe("ok");
    expect(deadCapabilities(evaluate(fixed))).toEqual([]);
  });
});

describe("our fault versus the driver's choice", () => {
  it("a declined permission is denied, never dead", () => {
    const declined: ProbeInput = {
      ...abelAndroid,
      bluetoothPermission: "denied",
      bluetoothPermissionAsked: true,
    };
    expect(verdictOf(declined, "bluetooth_permission")).toBe("denied");
    expect(deadCapabilities(evaluate(declined))).toEqual([]);
  });

  it("While Using is the driver's choice, not a broken plugin", () => {
    const whileUsing: ProbeInput = { ...abelAndroid, locationAuthorization: "whenInUse" };
    expect(verdictOf(whileUsing, "location_always")).toBe("denied");
    // Asserted on THIS capability, not on the whole fixture: the Abel
    // baseline still carries the unshown Bluetooth prompt, which is a
    // real and separate fault.
    expect(
      deadCapabilities(evaluate(whileUsing)).map((c) => c.id),
    ).not.toContain("location_always");
  });

  it("a geofence disarmed for lack of Always is denied, not dead", () => {
    const p: ProbeInput = {
      ...abelAndroid,
      geofenceArmState: "disarmed_no_background_permission",
    };
    expect(verdictOf(p, "geofence_armed")).toBe("denied");
  });

  it("having no places yet is LIVE, because nothing is wrong", () => {
    // A new driver has learned no places. The plugin is working
    // perfectly and has nothing to arm. Reporting that as a fault would
    // make the check cry wolf on every fresh install.
    const p: ProbeInput = { ...abelAndroid, geofenceArmState: "disarmed_no_places", geofenceCount: 0 };
    expect(verdictOf(p, "geofence_armed")).toBe("live");
    expect(deadCapabilities(evaluate(p)).map((c) => c.id)).not.toContain(
      "geofence_armed",
    );
  });

  it("a real arm failure IS dead", () => {
    const p: ProbeInput = { ...abelAndroid, geofenceArmState: "disarmed_registration_failed" };
    expect(verdictOf(p, "geofence_armed")).toBe("dead");
  });
});

describe("telling slow apart from unregistered", () => {
  it("treats a single-digit rejection as unregistered", () => {
    const p: ProbeInput = { ...graceIos, deviceStatusMs: UNREGISTERED_MS_CEILING };
    expect(evaluate(p).find((c) => c.id === "device_status_plugin")!.detail)
      .toMatch(/not registered/i);
  });

  it("does not claim registration failure for a slow honest failure", () => {
    // A plugin that is registered but genuinely failed takes real time.
    // Naming the wrong cause sends the next person down the wrong path.
    const p: ProbeInput = { ...graceIos, deviceStatusMs: 4000, deviceStatusStage: "timeout" };
    const c = evaluate(p).find((x) => x.id === "device_status_plugin")!;
    expect(c.verdict).toBe("dead");
    expect(c.detail).not.toMatch(/not registered/i);
  });
});

describe("the platform must come from the OS, not from the dead plugin", () => {
  it("still reports dead when the plugin returns nothing at all", () => {
    // THE BUG THAT MADE THIS WHOLE MODULE INERT.
    //
    // native-tracker derived platform from `truth`, which IS the device
    // status the plugin returns. A dead plugin returns nothing, so truth
    // was null, platform fell back to "web", every capability reported
    // `unsupported`, and the summary came out "ok".
    //
    // The module was blind on exactly the devices it was written for,
    // and the graceIos fixture hid it by hardcoding platform "ios", a
    // state production could not reach. Platform now comes from
    // Capacitor.getPlatform(), which answers whether or not any plugin
    // is alive.
    const everythingNull = {
      ...graceIos,
      deviceStatusOk: false, deviceStatusMs: 1, deviceStatusStage: "call",
      locationAuthorization: null, geofenceArmState: null,
    };
    expect(summarizeForHeartbeat(evaluate(everythingNull))).toMatch(/^dead=/);
  });

  it("a web platform with the same nulls is genuinely fine", () => {
    // The distinction the fallback destroyed: web has no plugins, so
    // nulls there mean nothing is wrong.
    const asWeb = { ...graceIos, platform: "web" as const };
    expect(summarizeForHeartbeat(evaluate(asWeb))).toBe("ok");
  });
});

describe("a plugin that answers with nothing is not healthy", () => {
  it("does not report live merely because the probe reached done", () => {
    // getDeviceStatusProbed calls onStage("done") BEFORE checking that a
    // value came back, so stage alone cannot tell a real answer from an
    // empty one. The tracker now passes outcome === "ok" instead.
    const answeredNothing = {
      ...graceIos,
      deviceStatusOk: false, deviceStatusStage: "done", deviceStatusMs: 40,
    };
    expect(verdictOf(answeredNothing, "device_status_plugin")).toBe("dead");
  });
});

describe("web and unprobed states stay quiet", () => {
  it("never reports web as broken", () => {
    expect(deadCapabilities(evaluate(web))).toEqual([]);
    expect(summarizeForHeartbeat(evaluate(web))).toBe("ok");
  });

  it("an unprobed native device is unknown, not dead", () => {
    // Before the first probe completes we genuinely do not know. Saying
    // "dead" here would fire on every cold start.
    const fresh: ProbeInput = { ...web, platform: "android", probed: false };
    expect(deadCapabilities(evaluate(fresh))).toEqual([]);
    expect(summarizeForHeartbeat(evaluate(fresh))).toMatch(/^unknown=/);
  });
});

describe("the human-facing line", () => {
  it("leads with what is broken", () => {
    expect(describeChecks(evaluate(graceIos))).toMatch(/shipped but not working/i);
  });

  it("falls back to permissions when nothing is broken", () => {
    const declined: ProbeInput = {
      ...abelAndroid, bluetoothPermission: "denied", bluetoothPermissionAsked: true,
    };
    expect(describeChecks(evaluate(declined))).toMatch(/not granted/i);
  });

  it("says so plainly when all is well", () => {
    const fixed = { ...abelAndroid, bluetoothPermission: "granted", bluetoothPermissionAsked: true };
    expect(describeChecks(evaluate(fixed))).toMatch(/every shipped capability is answering/i);
  });
});

/**
 * THE WIRING, not the module.
 *
 * Every test above drives evaluate() directly with a hand-built input.
 * That is necessary and it is NOT sufficient, and the gap is exactly how
 * this module shipped inert: the tracker fed it a platform derived from
 * the dead plugin's own payload, so a broken iPhone summarised as "ok"
 * while all 21 unit tests stayed green.
 *
 * Mutation-verified: reverting the tracker to the old derivation leaves
 * every behavioural test above passing. Only reading the call site
 * catches it. This is the third time in one day that a guard tested its
 * own copy of the logic instead of the shipped path.
 */
const TRACKER = "lib/mileage/native-tracker.ts";

/**
 * The evaluateSelfCheck({ ... }) argument, and NOTHING after it.
 *
 * Was `slice(0, indexOf("}),"))`, which depended on the call being the
 * last expression inside the heartbeat payload. It is not any more: the
 * call was hoisted so ./self-repair.ts can act on the same verdicts, and
 * that one-character change ("}),"  ->  "});") silently extended every
 * block below to the whole heartbeat body. The negative assertions kept
 * passing while scanning code they were never meant to see, which would
 * have turned the catch-all into a random tripwire on unrelated fields.
 *
 * Brace matching instead, so the guards read the argument itself
 * wherever it lives.
 */
function selfCheckCallBlock(): string {
  const src = readFileSync(TRACKER, "utf8");
  const open = src.indexOf("{", src.indexOf("evaluateSelfCheck("));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error("evaluateSelfCheck argument not found - test is stale");
}

describe("the tracker feeds the self-check honestly", () => {
  it("takes platform from Capacitor, never from the device-status payload", () => {
    const block = selfCheckCallBlock();
    expect(
      block,
      "platform must come from cap.getPlatform(). Deriving it from " +
        "`truth` means a dead plugin yields null, platform falls back to " +
        "web, every capability reports unsupported, and the summary says " +
        "ok on precisely the devices this module exists to catch.",
    ).toContain("cap?.getPlatform?.()");
    expect(block, "truth is the dead plugin's own payload").not.toMatch(
      /platform:\s*\n?\s*truth\?\./,
    );
  });

  it("judges the device-status plugin on outcome, not on stage", () => {
    const block = selfCheckCallBlock();
    // onStage("done") fires before the value is checked, so a plugin
    // that answers with nothing reaches "done" and would read as live.
    expect(block).toContain('dsProbe.outcome === "ok"');
    expect(block).not.toContain('dsProbe.stage === "done"');
  });

  /**
   * These three were hardcoded null under a comment asserting car signals
   * are "NOT fetched on this path". carProbe is awaited earlier in the
   * same function and feeds six columns of the same heartbeat, so the
   * assertion was false and two checks reported "unknown" forever.
   *
   * A capability check wired to a literal cannot fail, which makes it
   * indistinguishable from a passing one. Guarding at the call site is
   * the only place that catches it: evaluate() was always correct.
   */
  it("feeds bluetooth permission from the car probe, not from a literal", () => {
    const block = selfCheckCallBlock();
    expect(block).toContain("carProbe.value?.bluetoothPermission");
    expect(block).toContain("carProbe.value?.bluetoothPermissionAsked");
    expect(block).not.toMatch(/bluetoothPermission:\s*null/);
    expect(block).not.toMatch(/bluetoothPermissionAsked:\s*null/);
  });

  it("judges the car-signals plugin on outcome, never on presence", () => {
    const block = selfCheckCallBlock();
    expect(block).toContain('carProbe.outcome === "ok"');
    expect(block).not.toMatch(/carSignalsOk:\s*null/);
    // `carProbe.value != null` would call a probe that returned an empty
    // payload "live", the same mistake deviceStatusOk already made once.
    expect(block).not.toMatch(/carSignalsOk:\s*carProbe\.value\s*!=\s*null/);
  });

  it("leaves no self-check input pinned to a bare literal", () => {
    // Catch-all. Any future input silently wired to null or a constant
    // produces a check that can never reach a verdict, which is the
    // failure mode this whole block exists to prevent.
    const block = selfCheckCallBlock();
    const pinned = [...block.matchAll(/^\s*(\w+):\s*(null|true|false),/gm)].map(
      (m) => m[1],
    );
    expect(pinned).toEqual([]);
  });
});

/**
 * Low Power Mode: the finding that only became visible once the iOS
 * plugins started answering.
 *
 * The first healthy iPhone heartbeat (2026-08-16, build 40) reported
 * low_power_mode = true on the phone whose drives had been going missing
 * for weeks. iOS throttles background activity in that mode, so it
 * produces the same symptom as a dead tracker while everything we ship
 * reports healthy. It had been null all along, for the dullest reason:
 * the plugin that reports it was never registered.
 */
describe("a device setting the driver controls", () => {
  const throttled: ProbeInput = { ...abelAndroid, lowPowerMode: true };

  it("is DEGRADED, never dead: this is not our bug", () => {
    // Calling it dead would put a false accusation in the one field
    // people trust to mean "we shipped something that does not work".
    expect(verdictOf(throttled, "low_power_mode")).toBe("degraded");
    expect(deadCapabilities(evaluate(throttled)).map((c) => c.id)).not.toContain(
      "low_power_mode",
    );
  });

  it("is not DENIED either: nobody refused a permission", () => {
    // denied would misdescribe both the cause and the fix.
    expect(verdictOf(throttled, "low_power_mode")).not.toBe("denied");
  });

  it("tells the driver where the switch is", () => {
    const c = evaluate({ ...throttled, platform: "ios" }).find(
      (x) => x.id === "low_power_mode",
    )!;
    expect(c.detail).toMatch(/Low Power Mode/i);
    expect(c.detail).toMatch(/Settings/i);
  });

  it("names the right setting per platform", () => {
    const android = evaluate(throttled).find((x) => x.id === "low_power_mode")!;
    expect(android.detail).toMatch(/Battery Saver/i);
  });

  it("reports unknown when the plugin never answered, not 'not throttled'", () => {
    // graceIos has dead plugins, so the value is null. Claiming "off"
    // from a null would assert a measurement we never took.
    expect(verdictOf(graceIos, "low_power_mode")).toBe("unknown");
  });

  it("ranks a measured degradation ABOVE an unmeasured unknown", () => {
    const both: ProbeInput = {
      ...abelAndroid,
      bluetoothPermission: "granted",
      bluetoothPermissionAsked: true,
      lowPowerMode: true,
      carSignalsOk: null, // unknown
    };
    // An actionable fact must not be buried under a missing measurement.
    expect(summarizeForHeartbeat(evaluate(both))).toMatch(/^degraded=/);
    expect(summarizeForHeartbeat(evaluate(both))).toContain("low_power_mode");
  });

  it("a dead capability still outranks it", () => {
    // Our bug is more urgent than their battery setting.
    const p: ProbeInput = { ...graceIos, lowPowerMode: true };
    expect(summarizeForHeartbeat(evaluate(p))).toMatch(/^dead=/);
  });
});
