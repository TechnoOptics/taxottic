import { describe, expect, it } from "vitest";
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
  locationAuthorization: null, backgroundLocation: null,
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
  locationAuthorization: "always", backgroundLocation: true,
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
