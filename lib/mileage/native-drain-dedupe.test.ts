import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPLOAD_BATCH_MAX } from "./flush-policy";

/**
 * THE DEFECT: both native buffers hold the SAME fix stream, and
 * drainNativeBuffers posted both of them.
 *
 * Measured on production rows. Two ingest POSTs 0.618 s apart
 * (created_at 02:16:31.405176 and 02:16:32.023579) each carried exactly
 * 1630 points. All 1630 pairs are coordinate-identical and offset by
 * exactly 0.6310 s, standard deviation 0.0000 across every row; each
 * batch carries a single millisecond phase (.297 and .928). So one fix
 * stream was stored twice.
 *
 * Ingest is idempotent on (driver_user_id, company_id, captured_at) and
 * a 631 ms difference is not a conflict, so BOTH copies landed. Merged
 * with the live stream they produce 1263 of 3351 transitions above
 * 60 m/s, worst about 88783 m/s, the pool segments to one 1527 mile /
 * 25 minute trip, isPlausibleTrip correctly refuses it, and the drive
 * never appears.
 *
 * The 631 ms phase is why an exact-timestamp dedupe cannot work, and it
 * is why these tests exercise the REAL geofence and device-status drains
 * over a mocked bridge rather than mocking the drains themselves: the
 * bug lives in what actually reaches the wire.
 */

const BASE_TS = 1_760_000_000_000;
/** Measured phase between the two buffered copies of the same stream. */
const PHASE_MS = 631;

type Posted = { url: string; data: Record<string, unknown> };
type IngestPoint = { ts: number; lat: number; lng: number };

const posted: Posted[] = [];
/** consumeBuffer({count}) calls, the geofence buffer's clear. */
const consumed: number[] = [];
/** clearBufferedLocations({upToTs}) calls, the device-status clear. */
const cleared: number[] = [];

let geofenceFixes: Array<{
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  time: number;
}> = [];
let nativePoints: Array<{
  ts: number;
  lat: number;
  lng: number;
  speedMps: number | null;
  accuracyM: number;
}> = [];
let nativeCompanyId = "company-1";
let ingestStatus = 200;

/** A drive: distinct coordinates, one per second, as the buffers store it. */
function drive(n: number, atMs: number, latSeed = 0) {
  return Array.from({ length: n }, (_, i) => ({
    lat: 44.7619 + (i + latSeed) * 0.0001,
    lng: -93.4731,
    ts: atMs + i * 1000,
  }));
}

function asGeofenceFixes(points: IngestPoint[]) {
  return points.map((p) => ({
    latitude: p.lat,
    longitude: p.lng,
    accuracy: 8,
    speed: 3,
    time: p.ts,
  }));
}

function asNativePoints(points: IngestPoint[]) {
  return points.map((p) => ({
    ts: p.ts,
    lat: p.lat,
    lng: p.lng,
    speedMps: 3,
    accuracyM: 8,
  }));
}

function ingestBodies(): Array<{
  companyId: string;
  points: IngestPoint[];
  backlog?: boolean;
}> {
  return posted
    .filter((p) => p.url.endsWith("/api/mileage/ingest"))
    .map((p) => p.data as never);
}

vi.mock("@capacitor/core", () => ({
  registerPlugin: (name: string) =>
    name === "TaxotticGeofence"
      ? {
          readBuffer: async () => ({
            fixes: geofenceFixes,
            count: geofenceFixes.length,
          }),
          consumeBuffer: async ({ count }: { count: number }) => {
            consumed.push(count);
            return { remaining: 0 };
          },
        }
      : {
          drainBufferedLocations: async () => ({
            points: nativePoints,
            companyId: nativeCompanyId,
          }),
          clearBufferedLocations: async ({ upToTs }: { upToTs: number }) => {
            cleared.push(upToTs);
            return { remaining: 0 };
          },
        },
  CapacitorHttp: {
    post: async (opts: { url: string; data: Record<string, unknown> }) => {
      posted.push({ url: opts.url, data: opts.data });
      return { status: ingestStatus, data: {} };
    },
  },
}));

vi.mock("./heartbeat-timer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./heartbeat-timer")>()),
  ensureHeartbeatTimer: () => {},
}));

async function drain(companyId = "company-1") {
  const mod = await import("./native-drain");
  mod.__resetNativeDrainForTest();
  return mod.drainNativeBuffers(companyId, "flush");
}

describe("two native buffers holding one fix stream", () => {
  beforeEach(() => {
    posted.length = 0;
    consumed.length = 0;
    cleared.length = 0;
    geofenceFixes = [];
    nativePoints = [];
    nativeCompanyId = "company-1";
    ingestStatus = 200;
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

  it("posts the observed 1630-fix stream once, not twice", async () => {
    // The production shape exactly: 1630 fixes in each buffer, same
    // coordinates, second copy offset by the measured 631 ms. Both drains
    // cap at UPLOAD_BATCH_MAX, so one batch of that size is the whole of
    // what should reach the server.
    const stream = drive(1630, BASE_TS);
    geofenceFixes = asGeofenceFixes(stream);
    nativePoints = asNativePoints(
      stream.map((p) => ({ ...p, ts: p.ts + PHASE_MS })),
    );

    const n = await drain();

    const bodies = ingestBodies();
    expect(bodies, "the same stream must not be posted twice").toHaveLength(1);
    expect(bodies[0].points).toHaveLength(UPLOAD_BATCH_MAX);
    expect(n).toBe(UPLOAD_BATCH_MAX);
  });

  it("drops the second copy from the buffer it was already posted from", async () => {
    // A suppressed copy that stays on disk is drained again in two
    // minutes and every two minutes after that, so suppression alone
    // would only move the double post rather than remove it.
    const stream = drive(40, BASE_TS);
    geofenceFixes = asGeofenceFixes(stream);
    nativePoints = asNativePoints(
      stream.map((p) => ({ ...p, ts: p.ts + PHASE_MS })),
    );

    await drain();

    expect(ingestBodies(), "no second post").toHaveLength(1);
    expect(cleared, "cleared anyway").toEqual([BASE_TS + 39 * 1000 + PHASE_MS]);
  });

  it("uploads the fixes only the second buffer holds", async () => {
    // THE LOSS HAZARD. The two buffers held identical sets in the
    // observed case and nothing guarantees that always holds. Anything
    // the sibling batch does not cover has to reach the server.
    const shared = drive(40, BASE_TS);
    const onlyNative = drive(15, BASE_TS + 40_000, 40);
    geofenceFixes = asGeofenceFixes(shared);
    nativePoints = asNativePoints([
      ...shared.map((p) => ({ ...p, ts: p.ts + PHASE_MS })),
      ...onlyNative,
    ]);

    const n = await drain();

    const bodies = ingestBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].points.map((p) => p.lat)).toEqual(
      onlyNative.map((p) => p.lat),
    );
    expect(n).toBe(40 + 15);
  });

  it("keeps a fix at a coordinate the sibling batch never carried", async () => {
    // Coverage is per fix, not per batch. A batch that overlaps in part
    // must not swallow the part that does not overlap.
    geofenceFixes = asGeofenceFixes(drive(10, BASE_TS));
    const elsewhere = [{ lat: 45.1, lng: -93.9, ts: BASE_TS + 3000 }];
    nativePoints = asNativePoints(elsewhere);

    await drain();

    const bodies = ingestBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].points).toEqual([
      expect.objectContaining({ lat: 45.1, lng: -93.9 }),
    ]);
  });

  it("keeps a fix that shares only its latitude with the sibling batch", async () => {
    // Driving due east moves the longitude and can leave the latitude
    // looking unchanged. Identity has to be BOTH halves of the
    // coordinate or a whole eastbound leg disappears.
    geofenceFixes = asGeofenceFixes([{ lat: 44.7, lng: -93.4, ts: BASE_TS }]);
    nativePoints = asNativePoints([{ lat: 44.7, lng: -93.5, ts: BASE_TS }]);

    await drain();

    const bodies = ingestBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].points).toEqual([
      expect.objectContaining({ lat: 44.7, lng: -93.5 }),
    ]);
  });

  it("clears past a covered fix that sits after the newest one it posted", async () => {
    // The two sets INTERLEAVE. clearBufferedLocations is a single
    // timestamp water mark, so a mark set to the newest fix this drain
    // posted would strand the covered fixes above it, and they would be
    // read, recognised and skipped on every drain from then on, forever.
    const onlyNative = drive(5, BASE_TS, 0);
    const shared = drive(10, BASE_TS + 5_000, 5);
    geofenceFixes = asGeofenceFixes(shared);
    nativePoints = asNativePoints([
      ...onlyNative,
      ...shared.map((p) => ({ ...p, ts: p.ts + PHASE_MS })),
    ]);

    await drain();

    const bodies = ingestBodies();
    expect(bodies[1].points).toHaveLength(5);
    expect(cleared).toEqual([BASE_TS + 14 * 1000 + PHASE_MS]);
  });

  it("keeps a fix at the same coordinate captured a different time", async () => {
    // Parked at the same spot on two separate occasions is two real
    // observations. Only the sub-second phase of one duplicated stream
    // may be collapsed.
    geofenceFixes = asGeofenceFixes([{ lat: 44.7, lng: -93.4, ts: BASE_TS }]);
    nativePoints = asNativePoints([
      { lat: 44.7, lng: -93.4, ts: BASE_TS + 600_000 },
    ]);

    await drain();

    expect(ingestBodies()).toHaveLength(2);
  });

  it("posts the second buffer whole when the first batch never reached the server", async () => {
    // A failed geofence POST leaves its fixes on disk and puts NOTHING on
    // the server, so it covers nothing. Treating a read batch as coverage
    // rather than a confirmed batch would delete the only other copy.
    const stream = drive(20, BASE_TS);
    geofenceFixes = asGeofenceFixes(stream);
    nativePoints = asNativePoints(
      stream.map((p) => ({ ...p, ts: p.ts + PHASE_MS })),
    );
    ingestStatus = 500;

    await drain();

    const bodies = ingestBodies();
    expect(bodies, "both drains must still try").toHaveLength(2);
    expect(bodies[1].points).toHaveLength(20);
    expect(consumed, "a refused batch is not consumed").toEqual([]);
    expect(cleared, "a refused batch is not cleared").toEqual([]);
  });

  it("posts the second buffer whole when no company is known for the first", async () => {
    // drainGeofenceBuffer cannot run without a companyId. With it skipped
    // there is no sibling batch at all and the second drain is on its own.
    nativePoints = asNativePoints(drive(20, BASE_TS));

    const n = await drain("");

    const bodies = ingestBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0].points).toHaveLength(20);
    expect(n).toBe(20);
  });

  it("never covers a fix belonging to a different company", async () => {
    // The two buffers carry their own companyId. Same coordinates under
    // a different company are different rows on the server, so the
    // sibling batch cannot stand in for them.
    const stream = drive(20, BASE_TS);
    geofenceFixes = asGeofenceFixes(stream);
    nativePoints = asNativePoints(
      stream.map((p) => ({ ...p, ts: p.ts + PHASE_MS })),
    );
    nativeCompanyId = "company-2";

    await drain();

    const bodies = ingestBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies[1].companyId).toBe("company-2");
    expect(bodies[1].points).toHaveLength(20);
  });

  it("does not clear the second buffer when its remaining fixes were refused", async () => {
    // Partial coverage plus a failed POST. Clearing to the batch high
    // water mark here would delete the uncovered fixes that never landed.
    const shared = drive(10, BASE_TS);
    const onlyNative = drive(5, BASE_TS + 10_000, 10);
    geofenceFixes = asGeofenceFixes(shared);
    nativePoints = asNativePoints([
      ...shared.map((p) => ({ ...p, ts: p.ts + PHASE_MS })),
      ...onlyNative,
    ]);
    let call = 0;
    const { CapacitorHttp } = await import("@capacitor/core");
    vi.spyOn(CapacitorHttp, "post").mockImplementation(
      async (opts: { url: string; data?: unknown }) => {
        call += 1;
        posted.push({ url: opts.url, data: opts.data as never });
        return { status: call === 1 ? 200 : 500, data: {} } as never;
      },
    );

    await drain();

    expect(ingestBodies()).toHaveLength(2);
    expect(cleared).toEqual([]);
    vi.restoreAllMocks();
  });

  it("declares backlog on both drains", async () => {
    // backlog suppresses only the BEHIND clock shift. Without it a drain
    // landing minutes late rewrites captured_at and manufactures a THIRD
    // timestamp variant of the same fixes.
    geofenceFixes = asGeofenceFixes(drive(5, BASE_TS));
    nativePoints = asNativePoints(drive(5, BASE_TS + 60_000, 100));

    await drain();

    const bodies = ingestBodies();
    expect(bodies).toHaveLength(2);
    expect(bodies.map((b) => b.backlog)).toEqual([true, true]);
  });
});
