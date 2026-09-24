import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The drain, exercised by CALLING it.
 *
 * `drainVehicleSignals`, `clearVehicleSignals` and `auditCaptureGap` in
 * device-status.ts were built, shipped in the iOS binary, and had ZERO
 * callers outside this file's subject. They are the fourth instance in
 * two days of this codebase's signature failure: code that compiles,
 * type-checks, looks wired, and never runs.
 *
 * So the collector is tested the way the ingest drains are (see
 * ingest-arms-heartbeat.test.ts): mock the Capacitor bridge, call the
 * function, assert on what came back. A source-level guard that the
 * heartbeat calls it lives in vehicle-signal-wiring.test.ts; this file
 * proves the thing being called actually does something.
 */

const BOOT = 1_799_000_000_000;
const NOW = 1_800_000_000_000;
const m = (n: number) => n * 60_000;

const calls = {
  drain: 0,
  audit: [] as Array<{ fromMs: number; toMs: number }>,
  cleared: [] as number[],
};

const stub = {
  events: [] as unknown[],
  motionAvailable: true,
  motionAuthorization: "authorized",
  auditResult: null as unknown,
  drainThrows: false,
};

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    drainVehicleSignals: async () => {
      calls.drain++;
      if (stub.drainThrows) throw new Error("bridge is wedged");
      return {
        events: stub.events,
        bootMs: BOOT,
        motionAvailable: stub.motionAvailable,
        motionAuthorization: stub.motionAuthorization,
      };
    },
    auditCaptureGap: async (o: { fromMs: number; toMs: number }) => {
      calls.audit.push(o);
      return stub.auditResult;
    },
    clearVehicleSignals: async (o: { upToTs: number }) => {
      calls.cleared.push(o.upToTs);
      return { remaining: 0 };
    },
  }),
}));

const AUDIT_KEY = "taxottic.mileage.motionAuditTo";

/**
 * The suite runs in the node environment (see vitest.config.ts), so the
 * WebView's localStorage has to be supplied. Only the three methods the
 * collector uses, so a fourth one appearing is a compile error here
 * rather than a silent no-op on device.
 */
const store = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    // device-status.ts refuses the bridge unless Capacitor says this is a
    // native platform, which is exactly right on device and has to be
    // supplied here.
    Capacitor: { isNativePlatform: () => true },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      clear: () => store.clear(),
    },
  },
});

async function subject() {
  return await import("./device-status");
}

function carConnect(tsMs: number, source = "event") {
  return {
    kind: "carAudioRoute",
    state: "connected",
    tsMs,
    monotonicMs: tsMs - BOOT,
    bootMs: BOOT,
    source,
    confidence: null,
  };
}

beforeEach(() => {
  calls.drain = 0;
  calls.audit = [];
  calls.cleared = [];
  stub.events = [];
  stub.motionAvailable = true;
  stub.motionAuthorization = "authorized";
  stub.auditResult = null;
  stub.drainThrows = false;
  window.localStorage.clear();
});

afterEach(() => {
  vi.resetModules();
});

describe("collectVehicleSignals", () => {
  it("actually calls the native drain", async () => {
    // The whole point. If this number is 0, the four exported functions
    // are dead again.
    const { collectVehicleSignals } = await subject();
    await collectVehicleSignals("ios", NOW);
    expect(calls.drain).toBe(1);
  });

  it("folds drained events into observations", async () => {
    stub.events = [carConnect(NOW - m(20))];
    const { collectVehicleSignals } = await subject();
    const r = await collectVehicleSignals("ios", NOW);
    expect(r.outcome).toBe("ok");
    expect(r.observations).toHaveLength(1);
    expect(r.observations[0]).toMatchObject({
      kind: "car_audio_route",
      platform: "ios",
      startedAtMs: NOW - m(20),
    });
  });

  it("reports the highest consumed timestamp so the caller can acknowledge", async () => {
    stub.events = [carConnect(NOW - m(20)), carConnect(NOW - m(3), "poll")];
    const { collectVehicleSignals } = await subject();
    const r = await collectVehicleSignals("ios", NOW);
    expect(r.upToTs).toBe(NOW - m(3));
  });

  it("never clears the buffer itself", async () => {
    // Read, then act, then acknowledge. A collector that cleared on its
    // own would take the evidence of a missed drive down with it when
    // the upload failed.
    stub.events = [carConnect(NOW - m(20))];
    const { collectVehicleSignals } = await subject();
    await collectVehicleSignals("ios", NOW);
    expect(calls.cleared).toEqual([]);
  });

  it("reports nothing to acknowledge when nothing was drained", async () => {
    const { collectVehicleSignals } = await subject();
    const r = await collectVehicleSignals("ios", NOW);
    expect(r.upToTs).toBe(0);
    expect(r.outcome).toBe("null");
  });

  it("carries the CoreMotion permission answer, which is the likely reason for silence", async () => {
    stub.motionAvailable = false;
    stub.motionAuthorization = "denied";
    const { collectVehicleSignals } = await subject();
    const r = await collectVehicleSignals("ios", NOW);
    expect(r.motionAvailable).toBe(false);
    expect(r.motionAuthorization).toBe("denied");
  });

  it("reports error rather than pretending the bridge answered", async () => {
    stub.drainThrows = true;
    const { collectVehicleSignals } = await subject();
    const r = await collectVehicleSignals("ios", NOW);
    expect(r.outcome).toBe("error");
    expect(r.observations).toEqual([]);
  });

  it("produces no observations on Android, whose signals arrive elsewhere", async () => {
    stub.events = [carConnect(NOW - m(20))];
    const { collectVehicleSignals } = await subject();
    const r = await collectVehicleSignals("android", NOW);
    expect(r.observations).toEqual([]);
    expect(r.rejected).toEqual([
      { kind: "car_audio_route", reason: "unsupported_on_platform" },
    ]);
  });
});

describe("the capture-gap audit", () => {
  it("does not audit a window it has no record of", async () => {
    // First run on a device. Auditing back over a period we never
    // watched would report gaps we have no business calling gaps.
    const { collectVehicleSignals } = await subject();
    const r = await collectVehicleSignals("ios", NOW);
    expect(calls.audit).toEqual([]);
    expect(r.auditStatus).toBe("skipped");
    expect(window.localStorage.getItem(AUDIT_KEY)).toBe(String(NOW));
  });

  it("audits the window since the last audit once it is long enough", async () => {
    window.localStorage.setItem(AUDIT_KEY, String(NOW - m(45)));
    stub.auditResult = { status: "ok", gapMs: m(45), automotiveMs: 0 };
    const { collectVehicleSignals } = await subject();
    const r = await collectVehicleSignals("ios", NOW);
    expect(calls.audit).toEqual([{ fromMs: NOW - m(45), toMs: NOW }]);
    expect(r.auditStatus).toBe("ok");
    expect(r.auditWindowS).toBe(45 * 60);
  });

  it("skips a window too short to be worth asking about", async () => {
    window.localStorage.setItem(AUDIT_KEY, String(NOW - m(5)));
    const { collectVehicleSignals } = await subject();
    const r = await collectVehicleSignals("ios", NOW);
    expect(calls.audit).toEqual([]);
    expect(r.auditStatus).toBe("skipped");
  });

  it("never looks back further than the OS actually retains", async () => {
    window.localStorage.setItem(AUDIT_KEY, String(NOW - m(60 * 24 * 30)));
    stub.auditResult = { status: "ok", automotiveMs: 0 };
    const { collectVehicleSignals } = await subject();
    await collectVehicleSignals("ios", NOW);
    expect(calls.audit[0].fromMs).toBe(NOW - m(60 * 24));
  });

  it("does not advance the watermark when the audit could not run", async () => {
    // Otherwise a device with Motion denied silently walks its watermark
    // forward and the window is lost for good.
    window.localStorage.setItem(AUDIT_KEY, String(NOW - m(45)));
    stub.auditResult = null;
    const { collectVehicleSignals } = await subject();
    await collectVehicleSignals("ios", NOW);
    expect(window.localStorage.getItem(AUDIT_KEY)).toBe(String(NOW - m(45)));
  });

  it("surfaces automotive time the OS says we missed", async () => {
    stub.events = [
      {
        kind: "captureAudit",
        state: "drivingMissed",
        tsMs: NOW - m(5),
        monotonicMs: NOW - m(5) - BOOT,
        bootMs: BOOT,
        source: "audit",
        confidence: null,
        detail: {
          fromTsMs: NOW - m(60),
          toTsMs: NOW - m(5),
          gapMs: m(55),
          automotiveMs: m(34),
        },
      },
    ];
    const { collectVehicleSignals } = await subject();
    const r = await collectVehicleSignals("ios", NOW);
    expect(r.gapAutomotiveMs).toBe(m(34));
    // Duration only. There is no location in motion history, so nothing
    // downstream may turn this into a distance.
    expect(r.observations).toEqual([]);
  });

  it("reports zero missed time when nothing was missed", async () => {
    const { collectVehicleSignals } = await subject();
    const r = await collectVehicleSignals("ios", NOW);
    expect(r.gapAutomotiveMs).toBe(0);
  });
});
