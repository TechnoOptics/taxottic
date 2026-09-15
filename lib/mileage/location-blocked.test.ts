import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { locationBlocked } from "./location-blocked";

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
});
