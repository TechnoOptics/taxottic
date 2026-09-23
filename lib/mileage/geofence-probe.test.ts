import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The bridge, mocked at the seam geofence.ts actually uses.
 *
 * vi.mock is HOISTED above every const in this file, so the spy has to
 * come from vi.hoisted or the factory closes over a temporal-dead-zone
 * binding, throws a ReferenceError inside probeGeofenceState's try, and
 * every outcome silently reads "error". That failure looks exactly like
 * a passing test of the rejection path.
 */
const bridge = vi.hoisted(() => ({ getState: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  // registerPlugin returns a proxy WHATEVER happens, registered or not.
  // That is the whole reason an unregistered plugin cannot be detected
  // until a method is called, and it is what this mock must preserve.
  registerPlugin: () => ({ getState: () => bridge.getState() }),
}));

/**
 * A module test passes while the caller feeds it a lie. The bug this
 * file exists for was entirely in the CALL SITE: probeGeofenceState
 * could be perfect and the heartbeat would still report a dead plugin
 * while `probed` was computed from a different probe's outcome.
 */
describe("the geofence probe is wired to the thing that judges it", () => {
  const tracker = readFileSync("lib/mileage/native-tracker.ts", "utf8");

  it("the heartbeat probes the geofence rather than reading it bare", () => {
    expect(tracker).toMatch(/probeWithin\(\s*\(\)\s*=>\s*probeGeofenceState\(\)/);
    expect(
      tracker,
      "a bare getGeofenceState read cannot report why it failed",
    ).not.toMatch(/within\(getGeofenceState\(\)/);
  });

  it("probed is derived from the geofence read alone", () => {
    expect(tracker).toMatch(/probed:\s*geofenceProbe\.outcome\s*!==\s*"timeout"/);
    expect(
      tracker,
      "the device-status probe must not vouch for the geofence read",
    ).not.toMatch(/probed:\s*geofence\s*!=\s*null\s*\|\|\s*dsProbe/);
  });

  it("both payloads carry the outcome", () => {
    expect(tracker.match(/geofenceProbe:\s*geofenceProbe\.outcome/g) ?? []).toHaveLength(2);
  });
});

/**
 * WHAT probeGeofenceState ACTUALLY RETURNS, against a mocked bridge.
 *
 * The block above greps native-tracker.ts, which is necessary and is
 * not sufficient: a review mutation that made probeGeofenceState return
 * "error" where it returns the not-native value survived all 850 tests,
 * because nothing anywhere asserted its output. That gap hid a worse
 * one. The first version of this change convicted the plugin only on a
 * "no plugin at all" outcome, and guard() never produces one on a
 * native platform, so geofence_plugin could no longer ever be reported
 * dead. A test at this level is what catches that: it is the only place
 * the real registerPlugin contract is modelled.
 */
describe("probeGeofenceState says why the read came back empty", () => {
  /** Pretend to be, or not to be, a native platform. */
  function setPlatform(isNative: boolean) {
    (globalThis as unknown as { window: unknown }).window = {
      Capacitor: { isNativePlatform: () => isNative },
    };
  }

  beforeEach(() => {
    bridge.getState.mockReset();
  });

  afterEach(() => {
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it("off-native there is no bridge to ask: unavailable", async () => {
    setPlatform(false);
    const { probeGeofenceState } = await import("./geofence");
    expect(await probeGeofenceState()).toEqual({
      value: null,
      outcome: "unavailable",
    });
    expect(bridge.getState, "nothing to call, so nothing was called").not.toHaveBeenCalled();
  });

  it("a plugin that answers is ok, and the value comes back", async () => {
    setPlatform(true);
    const state = { armState: "armed", registeredCount: 4 };
    bridge.getState.mockResolvedValue(state);
    const { probeGeofenceState } = await import("./geofence");
    const out = await probeGeofenceState();
    expect(out.outcome).toBe("ok");
    expect(out.value).toBe(state);
  });

  it("an UNREGISTERED plugin rejects, and that is error, not unavailable", async () => {
    // The whole point. registerPlugin hands back a proxy whatever
    // happens, so a plugin that was never handed to the bridge is
    // indistinguishable from a registered one until a method is called.
    // It then rejects. If this ever returned "unavailable", the
    // self-check's dead branch would become unreachable, which is
    // precisely the defect this test was added for.
    setPlatform(true);
    bridge.getState.mockRejectedValue(new Error('"TaxotticGeofence" plugin is not implemented'));
    const { probeGeofenceState } = await import("./geofence");
    expect(await probeGeofenceState()).toEqual({ value: null, outcome: "error" });
  });

  it("a plugin that resolves nothing is null, never error", async () => {
    // Unreachable today: getState is typed Promise<GeofenceState> and
    // both natives resolve an object or reject. Pinned anyway, because
    // "error" here would put a plugin that ANSWERED one millisecond
    // threshold away from being convicted as unregistered.
    setPlatform(true);
    bridge.getState.mockResolvedValue(null);
    const { probeGeofenceState } = await import("./geofence");
    expect(await probeGeofenceState()).toEqual({ value: null, outcome: "null" });
  });
});

/**
 * The timeout value itself.
 *
 * A review mutation making probeWithin resolve "ok" instead of
 * "timeout" for a call that never settles failed nothing. That constant
 * is now load-bearing in both directions: the self-check reads
 * "timeout" as "we did not manage to look" and reads a fast "error" as
 * a dead plugin, so a wrong word here either mutes a real death or
 * invents one.
 */
describe("probeWithin invents exactly one outcome, and it is timeout", () => {
  it("a call that never settles times out, and reports how long it waited", async () => {
    const { probeWithin } = await import("./native-tracker");
    const out = await probeWithin<string, "ok">(
      () => new Promise(() => {}),
      20,
    );
    expect(out.outcome).toBe("timeout");
    expect(out.value).toBeNull();
    expect(out.ms).toBeGreaterThanOrEqual(15);
  });

  it("a call that rejects is an error, and is NOT reported as a timeout", async () => {
    const { probeWithin } = await import("./native-tracker");
    const out = await probeWithin<string, "ok">(
      () => Promise.reject(new Error("not implemented")),
      2_000,
    );
    expect(out.outcome).toBe("error");
    expect(out.ms, "a rejection is fast, and the elapsed is the signature")
      .toBeLessThan(2_000);
  });
});
