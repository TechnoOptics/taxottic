import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

/**
 * The native uploader is useless without a company id, and the native
 * side has never had one: syncPlaces pushes places and nothing else.
 * This is a call-site guard because the failure mode is silence, not
 * an exception. A plugin method nobody calls is this project's default
 * failure.
 */
describe("the web layer hands the uploader its config", () => {
  const src = readFileSync("lib/mileage/geofence.ts", "utf8");

  it("pushes origin and company id on the same path that syncs places", () => {
    expect(src).toMatch(/setUploadConfig\(\{/);
    expect(src).toMatch(/origin:/);
    expect(src).toMatch(/companyId/);
  });

  it("declares the method on the plugin interface", () => {
    expect(src).toMatch(/setUploadConfig\(options:\s*\{\s*origin:\s*string;\s*companyId:\s*string;?\s*\}\)/);
  });

  /**
   * The declaration and a call somewhere in the file are not enough.
   * The point of the design is that native learns about the world at
   * exactly one moment, the one call that already proves the bridge is
   * alive, so the config cannot drift away from the places. Pin the
   * call to the body of syncLearnedPlaces, ahead of the syncPlaces it
   * rides along with.
   */
  it("makes the call inside syncLearnedPlaces, before syncPlaces", () => {
    const start = src.indexOf("export async function syncLearnedPlaces");
    expect(start).toBeGreaterThan(-1);
    const nextExport = src.indexOf("\nexport ", start + 1);
    const body = src.slice(start, nextExport === -1 ? src.length : nextExport);

    const configAt = body.indexOf("setUploadConfig({");
    const syncAt = body.indexOf("syncPlaces({");
    expect(configAt).toBeGreaterThan(-1);
    expect(syncAt).toBeGreaterThan(-1);
    expect(configAt).toBeLessThan(syncAt);
  });
});
