import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BLOCK_FROM_CACHE_MAX_AGE_MS,
  DEVICE_STATUS_MAX_AGE_MS,
  authorizationFromCache,
  deviceStatusFloorIso,
  locationBlocked,
} from "./location-blocked";

describe("location blocked", () => {
  it("names While Using as a block with the fix, and nothing otherwise", () => {
    expect(locationBlocked({ locationAuthorization: "whenInUse", trackingEnabled: true })).toEqual({
      blocked: true,
      short: "Location is While Using, so drives are not recorded off screen",
      fix: "Settings, Taxottic, Location, Always",
    });
    expect(locationBlocked({ locationAuthorization: "always", trackingEnabled: true })).toBeNull();
    expect(locationBlocked(null)).toBeNull();
  });
  it("is wired: the dashboard renders the strip and the toggle reads the block", () => {
    expect(readFileSync("app/dashboard/page.tsx", "utf8")).toMatch(/<LocationBlockedStrip/);
    expect(readFileSync("components/mileage/AutoTrackToggle.tsx", "utf8")).toMatch(/locationBlocked\(/);
  });

  it("does not let a stale cached read latch the block by itself", () => {
    // The cache is written by a live probe and a live probe runs only
    // from the tracker's start path, so a driver with tracking off keeps
    // the last whenInUse the phone ever reported. Granting Always while
    // the app was dead has to be able to clear the block, and a cached
    // answer this old cannot be the thing that keeps it on.
    const stale = {
      locationAuthorization: "whenInUse",
      ageMs: BLOCK_FROM_CACHE_MAX_AGE_MS + 1,
    };
    expect(authorizationFromCache(stale)).toBeNull();
    expect(
      locationBlocked({
        locationAuthorization: authorizationFromCache(stale),
        trackingEnabled: true,
      }),
    ).toBeNull();
    // A read from this session still speaks for the phone.
    const fresh = { locationAuthorization: "whenInUse", ageMs: 1_000 };
    expect(authorizationFromCache(fresh)).toBe("whenInUse");
    expect(
      locationBlocked({
        locationAuthorization: authorizationFromCache(fresh),
        trackingEnabled: true,
      })?.blocked,
    ).toBe(true);
  });

  it("is wired: the toggle bounds the cache and re-reads the phone on mount", () => {
    // The blocked branch needs an exit. Nothing else refreshes this cache
    // while tracking is off, so the mount that shows the block is also
    // the mount that has to ask the phone again.
    const src = readFileSync("components/mileage/AutoTrackToggle.tsx", "utf8");
    expect(src).toMatch(/authorizationFromCache\(/);
    expect(src).toMatch(/refreshDeviceStatusCache\(/);
    // BOTH reads, not just the seed. refreshDeviceStatusCache rewrites
    // the cache only when the probe came back ok, so on an unavailable,
    // error or null outcome the read after it returns the SAME old entry:
    // an unbounded second read puts the stale whenInUse straight back and
    // latches the block again one line further down.
    expect(src.match(/authorizationFromCache\(/g) ?? []).toHaveLength(2);
    expect(src).not.toMatch(/setAuthorization\(\s*\w+\.value\.locationAuthorization/);
  });

  it("says nothing to a driver who turned tracking off", () => {
    // While Using only blocks capture for someone who asked to be
    // captured. A driver who switched tracking off made a choice, and a
    // strip telling them to change a permission they do not need reads
    // as a bug in the app rather than a fault on the phone.
    expect(
      locationBlocked({ locationAuthorization: "whenInUse", trackingEnabled: false }),
    ).toBeNull();
    expect(
      locationBlocked({ locationAuthorization: "whenInUse", trackingEnabled: true })?.blocked,
    ).toBe(true);
    // Unknown (the row never carried the column) still speaks, because
    // that is the pre-plugin shape and not a decision the driver made.
    expect(
      locationBlocked({ locationAuthorization: "whenInUse", trackingEnabled: null })?.blocked,
    ).toBe(true);
  });

  it("is wired: the dashboard reads only a live, recent row", () => {
    // The row is the last thing the phone said, not a live probe. A
    // months-old whenInUse from an install the driver has since
    // reinstalled or re-permissioned would put a permanent strip on
    // Today with nothing on the phone left to fix.
    const dash = readFileSync("app/dashboard/page.tsx", "utf8");
    const query = dash.slice(dash.indexOf('.from("mileage_device_status")'));
    expect(query, "the query skips a driver who turned tracking off").toMatch(
      /\.eq\("tracking_enabled", true\)/,
    );
    expect(query, "the query bounds the row's age").toMatch(
      /\.gte\(\s*"reported_at",\s*deviceStatusFloorIso\(\)/,
    );
    expect(DEVICE_STATUS_MAX_AGE_MS).toBe(14 * 24 * 60 * 60 * 1000);
    // The bound is that constant and not some other window.
    const now = Date.UTC(2026, 8, 15, 12, 0, 0);
    expect(deviceStatusFloorIso(now)).toBe(
      new Date(now - DEVICE_STATUS_MAX_AGE_MS).toISOString(),
    );
    expect(deviceStatusFloorIso(now)).toBe("2026-09-01T12:00:00.000Z");
  });
});
