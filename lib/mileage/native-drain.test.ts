import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE DEFECT: the native on-disk buffer emptied on cold start and at no
 * other time, so upload latency was bounded by when the app was next
 * launched.
 *
 * Measured over 10 days: `geofence_buffered_fixes` climbing 832 to 1512
 * across a 37 minute stretch in which the JS layer was demonstrably
 * healthy (location callbacks every 1 to 2 seconds, `buffer_size` 8 to
 * 14, `fail_streak` 0). Single inserts of 3764, 2289, 2264 and 1630
 * points exist, which is more than FLUSH_BATCH_MAX, so they cannot have
 * come from the JS flush loop at all. See docs/design/upload-latency.md.
 *
 * This module is the missing call site, and it exists as a module rather
 * than as four lines inside native-tracker for the same reason
 * flush-policy does: the decision is the part that was wrong, and the
 * decision has to be testable without a WebView, a timer or a phone.
 */

const calls = { geofence: 0, native: 0 };
let geofenceResult: Promise<number> | number = 1;
let nativeResult: Promise<number> | number = 0;

vi.mock("./geofence", () => ({
  drainGeofenceBuffer: vi.fn(async () => {
    calls.geofence++;
    return geofenceResult;
  }),
}));

vi.mock("./device-status", () => ({
  drainNativeLocationBuffer: vi.fn(async () => {
    calls.native++;
    return nativeResult;
  }),
}));

async function load() {
  const mod = await import("./native-drain");
  mod.__resetNativeDrainForTest();
  return mod;
}

describe("draining the native buffers outside cold start", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_000_000);
    calls.geofence = 0;
    calls.native = 0;
    geofenceResult = 1;
    nativeResult = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("drains both buffers and reports the combined count", async () => {
    const { drainNativeBuffers } = await load();
    nativeResult = 2;

    const n = await drainNativeBuffers("company-1", "flush");

    expect(n).toBe(3);
    expect(calls.geofence).toBe(1);
    expect(calls.native).toBe(1);
  });

  it("records the trigger, which is the only production evidence this shipped", async () => {
    const { drainNativeBuffers, nativeDrainDiag } = await load();

    await drainNativeBuffers("company-1", "callback");

    expect(nativeDrainDiag.lastTrigger).toBe("callback");
    expect(nativeDrainDiag.lastPoints).toBe(1);
    expect(nativeDrainDiag.lastAtMs).toBe(Date.now());
  });

  it("records the trigger even when both buffers were empty", async () => {
    // An attempt that found nothing still proves the wiring is live. A
    // signal that only appears when there is a backlog cannot distinguish
    // "the drain runs and finds nothing" from "the drain never runs",
    // which is the exact ambiguity this whole change exists to remove.
    const { drainNativeBuffers, nativeDrainDiag } = await load();
    geofenceResult = 0;

    await drainNativeBuffers("company-1", "resume");

    expect(nativeDrainDiag.lastTrigger).toBe("resume");
    expect(nativeDrainDiag.lastPoints).toBe(0);
  });

  it("refuses a second drain while one is still in flight", async () => {
    // THE DOUBLE-POST HAZARD. The flush tick and a resume can land on the
    // same instant, and each drain is a read-then-post-then-consume with
    // two network round trips in the middle. Two overlapping drains read
    // the same fixes and post them twice. Ingest dedupes on (driver,
    // company, captured_at), but relying on that alone means the design
    // is "post it twice and hope the key holds".
    const { drainNativeBuffers, NATIVE_DRAIN_EVERY_MS } = await load();
    let release: (n: number) => void = () => {};
    geofenceResult = new Promise<number>((r) => {
      release = r;
    });

    const first = drainNativeBuffers("company-1", "flush");
    // Deliberately PAST the interval, so the wall-clock gate cannot be
    // what refuses the second call and this test can only pass on the
    // in-flight guard. That is also the real case: a drain uploading a
    // day of backlog over a bad connection easily outlives two minutes
    // while location callbacks keep arriving every second.
    vi.setSystemTime(Date.now() + NATIVE_DRAIN_EVERY_MS * 2);
    const second = await drainNativeBuffers("company-1", "resume");

    expect(second, "the overlapping drain must be a no-op").toBe(0);
    expect(calls.geofence).toBe(1);

    release(5);
    expect(await first).toBe(5);
  });

  it("does not re-drain inside the interval", async () => {
    // readBuffer() reads the whole on-disk JSONL file. A bridge hop that
    // size on every location callback (about one per second while
    // driving) is a battery regression, not a fix.
    const { drainNativeBuffers, NATIVE_DRAIN_EVERY_MS } = await load();

    await drainNativeBuffers("company-1", "flush");
    vi.setSystemTime(Date.now() + NATIVE_DRAIN_EVERY_MS - 1);
    const again = await drainNativeBuffers("company-1", "callback");

    expect(again).toBe(0);
    expect(calls.geofence).toBe(1);
  });

  it("drains again once the interval has elapsed on WALL CLOCK", async () => {
    // Deliberately never runs a timer. A backgrounded WebView freezes
    // setInterval while native location callbacks keep arriving, and this
    // codebase has measured timer_lag_ms of 15 hours. The gate has to be
    // a wall-clock comparison evaluated by whatever event did fire.
    const { drainNativeBuffers, NATIVE_DRAIN_EVERY_MS } = await load();

    await drainNativeBuffers("company-1", "flush");
    vi.setSystemTime(Date.now() + NATIVE_DRAIN_EVERY_MS);
    const again = await drainNativeBuffers("company-1", "callback");

    expect(again).toBe(1);
    expect(calls.geofence).toBe(2);
  });

  it("counts a skipped attempt as an attempt, so nothing hammers the bridge", async () => {
    // The interval must be measured from the ATTEMPT, not from the last
    // attempt that happened to move points. Otherwise a device with empty
    // buffers pays a bridge round trip on every callback forever.
    const { drainNativeBuffers, NATIVE_DRAIN_EVERY_MS } = await load();
    geofenceResult = 0;

    await drainNativeBuffers("company-1", "callback");
    vi.setSystemTime(Date.now() + NATIVE_DRAIN_EVERY_MS - 1);
    await drainNativeBuffers("company-1", "callback");

    expect(calls.geofence).toBe(1);
  });

  it("still drains the iOS buffer when no company is known", async () => {
    // drainNativeLocationBuffer carries its own companyId from the native
    // side; drainGeofenceBuffer cannot run without one. A resume that
    // fires before the tracker has a company must not lose the iOS drain.
    const { drainNativeBuffers } = await load();
    nativeResult = 4;

    const n = await drainNativeBuffers("", "resume");

    expect(n).toBe(4);
    expect(calls.geofence).toBe(0);
    expect(calls.native).toBe(1);
  });

  it("releases the guard when a drain throws", async () => {
    // A wedged guard is worse than no guard: it converts one transient
    // failure into permanent silence, which is the failure mode this
    // subsystem keeps producing.
    const { drainNativeBuffers, NATIVE_DRAIN_EVERY_MS } = await load();
    geofenceResult = Promise.reject(new Error("bridge gone"));

    await expect(drainNativeBuffers("company-1", "flush")).resolves.toBe(0);

    geofenceResult = 1;
    vi.setSystemTime(Date.now() + NATIVE_DRAIN_EVERY_MS);
    expect(await drainNativeBuffers("company-1", "flush")).toBe(1);
  });
});
