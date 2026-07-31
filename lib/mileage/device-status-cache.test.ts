import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readDeviceStatusCache } from "./device-status";

/**
 * The foreground device-truth cache.
 *
 * This is the fallback that stops location_authorization /
 * precise_location / battery_optimized / background_refresh from being
 * NULL when the live bridge probe times out. Two properties matter and
 * both are easy to break silently:
 *
 *  1. A malformed or partial cache entry must read as "no cache", never
 *     as a half-populated device status. A wrong answer here is worse
 *     than the NULL it replaces.
 *  2. The age must always travel with the value. A consumer has to be
 *     able to tell "battery optimization was off 40 seconds ago" from
 *     "nine hours ago", so an entry without a usable timestamp is not
 *     a usable entry.
 */

const KEY = "taxottic.mileage.deviceStatus";

let store: Record<string, string>;

beforeEach(() => {
  store = {};
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
      removeItem: (k: string) => {
        delete store[k];
      },
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as unknown as { window?: unknown }).window;
});

describe("readDeviceStatusCache", () => {
  it("returns null when nothing has ever been cached", () => {
    expect(readDeviceStatusCache()).toBeNull();
  });

  it("returns null on unparseable JSON rather than throwing", () => {
    store[KEY] = "{not json";
    expect(readDeviceStatusCache()).toBeNull();
  });

  it("returns null when the entry has no capture timestamp", () => {
    // A value with no age is not usable: it cannot be distinguished
    // from a nine-hour-old value, which is the failure mode this whole
    // cache exists to avoid.
    store[KEY] = JSON.stringify({
      value: { platform: "android", locationAuthorization: "always" },
    });
    expect(readDeviceStatusCache()).toBeNull();
  });

  it("returns null when the entry has a timestamp but no value", () => {
    store[KEY] = JSON.stringify({ capturedAtMs: 1_000 });
    expect(readDeviceStatusCache()).toBeNull();
  });

  it("returns the value with its age in ms", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00Z"));
    const capturedAtMs = Date.now() - 90_000;
    store[KEY] = JSON.stringify({
      value: {
        platform: "android",
        locationAuthorization: "always",
        preciseLocation: true,
        batteryOptimized: false,
      },
      capturedAtMs,
    });

    const cached = readDeviceStatusCache();
    expect(cached).not.toBeNull();
    expect(cached?.value.locationAuthorization).toBe("always");
    expect(cached?.value.batteryOptimized).toBe(false);
    expect(cached?.capturedAtMs).toBe(capturedAtMs);
    expect(cached?.ageMs).toBe(90_000);
  });

  it("never reports a negative age when the clock moved backwards", () => {
    // Device clocks do move backwards (NTP correction, manual change).
    // A negative age would read downstream as "fresher than live".
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T12:00:00Z"));
    store[KEY] = JSON.stringify({
      value: { platform: "ios", locationAuthorization: "whenInUse" },
      capturedAtMs: Date.now() + 60_000,
    });
    expect(readDeviceStatusCache()?.ageMs).toBe(0);
  });
});
