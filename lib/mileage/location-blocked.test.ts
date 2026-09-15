import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BLOCK_FROM_CACHE_MAX_AGE_MS,
  authorizationFromCache,
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
  });
});
