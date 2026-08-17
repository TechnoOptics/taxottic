import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPLOAD_BATCH_MAX } from "./flush-policy";

/**
 * How the two native-buffer drains put points on the wire.
 *
 * Both were raw `fetch` with no batch cap, which made the single upload
 * that can carry an entire day of driving the only one skipping the
 * native HTTP stack, and the only one able to post thousands of points
 * in one body. Production holds single inserts of 3764, 2289, 2264 and
 * 1630 points; UPLOAD_BATCH_MAX is 800, and a 179 KB body is already
 * known to break uploads outright on a real handset.
 *
 * Both properties only started to matter once the drain ran more than
 * once per app launch, which is what lib/mileage/native-drain.ts does.
 */

const posted: Array<{ url: string; data: Record<string, unknown> }> = [];
const consumed: number[] = [];
const cleared: number[] = [];

let bufferedFixCount = 1;
let nativePointCount = 1;

const BASE_TS = 1_760_000_000_000;

function fixes(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    latitude: 44.7619,
    longitude: -93.4731,
    accuracy: 8,
    speed: 0,
    time: BASE_TS + i * 1000,
  }));
}

function nativePoints(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ts: BASE_TS + i * 1000,
    lat: 44.7619,
    lng: -93.4731,
    speedMps: 0,
    accuracyM: 8,
  }));
}

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    readBuffer: async () => ({
      fixes: fixes(bufferedFixCount),
      count: bufferedFixCount,
    }),
    consumeBuffer: async ({ count }: { count: number }) => {
      consumed.push(count);
      return { remaining: 0 };
    },
    drainBufferedLocations: async () => ({
      points: nativePoints(nativePointCount),
      companyId: "company-1",
    }),
    clearBufferedLocations: async ({ upToTs }: { upToTs: number }) => {
      cleared.push(upToTs);
      return { remaining: 0 };
    },
  }),
  CapacitorHttp: {
    post: async (opts: { url: string; data: Record<string, unknown> }) => {
      posted.push({ url: opts.url, data: opts.data });
      return { status: 200, data: {} };
    },
  },
}));

vi.mock("./heartbeat-timer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./heartbeat-timer")>()),
  ensureHeartbeatTimer: () => {},
}));

describe("a native-buffer drain puts points on the wire", () => {
  beforeEach(() => {
    posted.length = 0;
    consumed.length = 0;
    cleared.length = 0;
    bufferedFixCount = 1;
    nativePointCount = 1;
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200 })));
    vi.stubGlobal("window", {
      Capacitor: { isNativePlatform: () => true },
      location: { origin: "https://taxottic.com" },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  describe("the Android geofence drain", () => {
    it("posts the geofence batch over the native HTTP stack", async () => {
      // Android throttles WebView-issued HTTP after roughly 5 minutes in
      // the background. This drain now fires from the location callback,
      // which is precisely the backgrounded case, so it can no longer be
      // the one upload path left on fetch.
      const { drainGeofenceBuffer } = await import("./geofence");
      await drainGeofenceBuffer("company-1");

      expect(posted).toHaveLength(1);
      expect(posted[0].url).toBe("https://taxottic.com/api/mileage/ingest");
      expect(fetch).not.toHaveBeenCalled();
    });

    it("declares the geofence batch as backlog", async () => {
      // Without this the server infers backlog from lag alone, and a
      // drain taken minutes after a drive lands in the one band where
      // that inference is wrong. See lib/mileage/clock-skew.ts.
      const { drainGeofenceBuffer } = await import("./geofence");
      await drainGeofenceBuffer("company-1");

      expect(posted[0].data.backlog).toBe(true);
    });

    it("caps the batch and consumes only what it posted", async () => {
      const { drainGeofenceBuffer } = await import("./geofence");
      bufferedFixCount = UPLOAD_BATCH_MAX + 250;

      const n = await drainGeofenceBuffer("company-1");

      expect(n).toBe(UPLOAD_BATCH_MAX);
      expect(
        (posted[0].data.points as unknown[]).length,
        "an uncapped drain is how a 3764-point insert happened",
      ).toBe(UPLOAD_BATCH_MAX);
      expect(
        consumed,
        "consuming more than was posted would delete fixes that never " +
          "reached the server",
      ).toEqual([UPLOAD_BATCH_MAX]);
    });

    it("consumes the whole buffer when it fits", async () => {
      const { drainGeofenceBuffer } = await import("./geofence");
      bufferedFixCount = 12;

      expect(await drainGeofenceBuffer("company-1")).toBe(12);
      expect(consumed).toEqual([12]);
    });
  });

  describe("the iOS native location drain", () => {
    it("posts the iOS batch over the native HTTP stack too", async () => {
      const { drainNativeLocationBuffer } = await import("./device-status");
      await drainNativeLocationBuffer();

      expect(posted).toHaveLength(1);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("declares the iOS batch as backlog", async () => {
      const { drainNativeLocationBuffer } = await import("./device-status");
      await drainNativeLocationBuffer();

      expect(posted[0].data.backlog).toBe(true);
    });

    it("caps the batch and clears only up to the point it posted", async () => {
      // clearBufferedLocations is by TIMESTAMP, so a cap that still
      // cleared the buffer's true maximum would silently delete every
      // fix it declined to send.
      const { drainNativeLocationBuffer } = await import("./device-status");
      nativePointCount = UPLOAD_BATCH_MAX + 100;

      const n = await drainNativeLocationBuffer();

      expect(n).toBe(UPLOAD_BATCH_MAX);
      expect(cleared).toEqual([BASE_TS + (UPLOAD_BATCH_MAX - 1) * 1000]);
    });
  });
});
