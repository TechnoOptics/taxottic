import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getDeviceId } from "./device-id";

/**
 * The bug this exists to prevent: mileage_device_status keeps one row per
 * (driver, company), so a driver with two devices has them overwrite each
 * other. On 2026-08-15 that produced a status row alternating between
 * app_version 1.3.9 and 1.3.1 thirty-one seconds apart, which reads as a
 * downgrade and was diagnosed as one. It was two phones.
 */

function withStorage(store: Map<string, string> | null) {
  const win = store
    ? {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
        },
      }
    : {
        localStorage: {
          getItem: () => {
            throw new Error("SecurityError: storage disabled");
          },
          setItem: () => {
            throw new Error("SecurityError: storage disabled");
          },
        },
      };
  vi.stubGlobal("window", win);
}

describe("getDeviceId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is STABLE across calls, or the history it feeds is noise", () => {
    // An id regenerated per call would make every heartbeat look like a
    // brand new device, which is strictly worse than no id at all: it
    // destroys the timeline instead of merely failing to split it.
    withStorage(new Map());
    const a = getDeviceId();
    const b = getDeviceId();
    const c = getDeviceId();
    expect(a).toBeTruthy();
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it("persists so a reload keeps the same device", () => {
    const store = new Map<string, string>();
    withStorage(store);
    const first = getDeviceId();
    vi.unstubAllGlobals();
    withStorage(store); // same storage, fresh page
    expect(getDeviceId()).toBe(first);
  });

  it("gives two independent installs DIFFERENT ids", () => {
    // The entire point: the two phones must not collide.
    withStorage(new Map());
    const phoneA = getDeviceId();
    vi.unstubAllGlobals();
    withStorage(new Map());
    const phoneB = getDeviceId();
    expect(phoneA).not.toBe(phoneB);
  });

  it("returns null rather than inventing one when storage is unavailable", () => {
    // Private mode / locked WebView. Null is honest and stores as null.
    // A per-call id here would silently poison the per-device grouping.
    withStorage(null);
    expect(getDeviceId()).toBeNull();
  });

  it("returns null on the server", () => {
    vi.stubGlobal("window", undefined);
    expect(getDeviceId()).toBeNull();
  });

  it("is prefixed so it cannot be mistaken for another id in the row", () => {
    withStorage(new Map());
    expect(getDeviceId()).toMatch(/^dev_/);
  });

  it("carries no hardware or personal signal", () => {
    // Deliberately a random uuid. A real device identifier would change
    // what this app has to disclose in two store privacy declarations,
    // to answer a question a random id answers completely.
    // Strip comments FIRST. The initial version of this test matched the
    // module's own doc comment, which names ANDROID_ID and "user agent"
    // precisely to say it does not use them, and so failed on prose while
    // the code was correct. A guard that reads documentation as
    // implementation is worse than none: it fails on the honest file and
    // would pass on a file that quietly did the wrong thing in silence.
    const code = readFileSync("lib/mileage/device-id.ts", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(
      /userAgent|screen\.|identifierForVendor|ANDROID_ID|navigator\./,
    );
    expect(code).toMatch(/randomUUID|getRandomValues/);
  });
});

/**
 * Call-site guards. The field is useless unless it is actually SENT and
 * actually STORED, and neither is provable from this module.
 */
describe("the device id reaches the database", () => {
  it("the tracker sends it on the heartbeat", () => {
    const src = readFileSync("lib/mileage/native-tracker.ts", "utf8");
    expect(src).toContain("deviceId: getDeviceId()");
    expect(src).toMatch(/import \{ getDeviceId \} from "\.\/device-id"/);
  });

  it("the heartbeat route stores it", () => {
    const src = readFileSync("app/api/mileage/heartbeat/route.ts", "utf8");
    expect(src).toMatch(/device_id:\s*str\("deviceId"/);
  });

  it("the status row stays ONE per driver, so readers keep working", () => {
    // finalize.ts and mileage-finalize both maybeSingle() this table;
    // PostgREST errors when maybeSingle matches more than one row. Adding
    // device_id to the conflict target would break the tail-close
    // decision and the stall alarm for exactly the multi-device drivers
    // this feature is for.
    const src = readFileSync("app/api/mileage/heartbeat/route.ts", "utf8");
    expect(src).toContain('onConflict: "driver_user_id,company_id"');
    expect(src).not.toMatch(/onConflict:\s*"[^"]*device_id/);
  });
});
