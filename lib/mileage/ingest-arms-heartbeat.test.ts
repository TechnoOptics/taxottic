import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The heartbeat invariant, tested by CALLING the ingest paths.
 *
 * lib/mileage/heartbeat-timer.test.ts asserts the same rule by grepping
 * source text for `ensureHeartbeatTimer()` near each POST. That static
 * check earns its place (it is the only thing that can cover the private
 * flush() in native-tracker), but a review flagged it as the weakest test
 * in the mileage suite, and rightly: wrap the call in a helper and the
 * regex stops matching while the behaviour is still correct, or worse,
 * refactor the arming away and the regex still matches a stale comment.
 *
 * Two of the three ingest paths are exported and can simply be called:
 *
 *   geofence.ts       drainGeofenceBuffer      the geofence wake drain
 *   device-status.ts  drainNativeLocationBuffer the native buffer drain
 *
 * So those two get real coverage here: mock the Capacitor bridge, mock
 * fetch, call the function, assert a heartbeat actually fired. The third
 * (native-tracker's flush) stays with the static check because it is not
 * exported, and that split is deliberate rather than an oversight.
 *
 * What this catches that the regex cannot: arming that is present in the
 * source but never reached, arming behind a condition that is false in
 * practice, and any future refactor that moves the call somewhere the
 * regex still sees but execution does not.
 */

const beats = { count: 0 };

/** A Capacitor plugin proxy stand-in holding one buffered fix. */
function pluginStub() {
  return {
    readBuffer: async () => ({
      fixes: [
        {
          latitude: 44.7619,
          longitude: -93.4731,
          accuracy: 8,
          speed: 0,
          time: 1_760_000_000_000,
        },
      ],
      count: 1,
    }),
    consumeBuffer: async () => ({ remaining: 0 }),
    drainBufferedLocations: async () => ({
      points: [
        {
          ts: 1_760_000_000_000,
          lat: 44.7619,
          lng: -93.4731,
          speedMps: 0,
          accuracyM: 8,
        },
      ],
      companyId: "company-1",
    }),
    clearBufferedLocations: async () => ({ remaining: 0 }),
    getStatus: async () => ({
      platform: "android",
      locationAuthorization: "always",
      preciseLocation: true,
    }),
  };
}

vi.mock("@capacitor/core", () => ({
  // Boxed by the callers, never returned bare. See plugin-box.test.ts for
  // why returning this proxy from an async function would hang forever.
  registerPlugin: () => pluginStub(),
}));

// The sender is registered by native-tracker at module scope in the real
// app. Here we substitute a counter so a beat is observable without any
// network or Capacitor bridge.
vi.mock("./heartbeat-timer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./heartbeat-timer")>();
  return {
    ...actual,
    ensureHeartbeatTimer: () => {
      beats.count++;
    },
  };
});

describe("every callable ingest path reports health alongside its points", () => {
  beforeEach(() => {
    beats.count = 0;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    vi.stubGlobal("window", {
      Capacitor: { isNativePlatform: () => true },
      localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("the geofence wake drain beats when it uploads", async () => {
    const { drainGeofenceBuffer } = await import("./geofence");
    const uploaded = await drainGeofenceBuffer("company-1");

    expect(uploaded, "the fixture fix should have been uploaded").toBe(1);
    expect(
      beats.count,
      "points reached /api/mileage/ingest through this path and no " +
        "heartbeat was armed, which is the 27 hour blackout reproduced",
    ).toBeGreaterThan(0);
  });

  it("the native buffer drain beats when it uploads", async () => {
    const { drainNativeLocationBuffer } = await import("./device-status");
    const uploaded = await drainNativeLocationBuffer();

    expect(uploaded).toBeGreaterThan(0);
    expect(beats.count).toBeGreaterThan(0);
  });

  it("does not beat when there is nothing to upload", async () => {
    // Guards against the lazy fix of arming unconditionally at the top of
    // the function. The invariant is "health accompanies POINTS", not
    // "health fires whenever this function is called", and a drain that
    // found an empty buffer has not reached the server at all.
    vi.doMock("@capacitor/core", () => ({
      registerPlugin: () => ({
        ...pluginStub(),
        readBuffer: async () => ({ fixes: [], count: 0 }),
      }),
    }));
    vi.resetModules();
    const { drainGeofenceBuffer } = await import("./geofence");

    beats.count = 0;
    const uploaded = await drainGeofenceBuffer("company-1");

    expect(uploaded).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
