import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * A module test passes while the caller feeds it a lie. The bug this
 * file exists for was entirely in the CALL SITE: probeGeofenceState
 * could be perfect and the heartbeat would still report a dead plugin
 * while `probed` was computed from a different probe's outcome.
 */
describe("the geofence probe is wired to the thing that judges it", () => {
  const tracker = readFileSync("lib/mileage/native-tracker.ts", "utf8");

  it("the heartbeat probes the geofence rather than reading it bare", () => {
    expect(tracker).toMatch(/probeWithin\(\s*\(\)\s*=>\s*probeGeofenceState\(\)/);
    expect(
      tracker,
      "a bare getGeofenceState read cannot report why it failed",
    ).not.toMatch(/within\(getGeofenceState\(\)/);
  });

  it("probed is derived from the geofence read alone", () => {
    expect(tracker).toMatch(/probed:\s*geofenceProbe\.outcome\s*!==\s*"timeout"/);
    expect(
      tracker,
      "the device-status probe must not vouch for the geofence read",
    ).not.toMatch(/probed:\s*geofence\s*!=\s*null\s*\|\|\s*dsProbe/);
  });

  it("both payloads carry the outcome", () => {
    expect(tracker.match(/geofenceProbe:\s*geofenceProbe\.outcome/g) ?? []).toHaveLength(2);
  });
});
