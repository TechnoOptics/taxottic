import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * THE INVARIANT: process protection is released when the DRIVE ends, never
 * when the app starts.
 *
 * Android killed this app four times in three days with reason=3
 * (LOW_MEMORY) at importance=400. Importance 400 is a CACHED process. The
 * phone was already on the doze allowlist in standby bucket 5 (EXEMPTED),
 * which is why "check your battery settings" was never going to fix it:
 * allowlisting exempts an app from Doze and App Standby and does exactly
 * nothing about the low-memory killer. Only foreground-service importance
 * does.
 *
 * The app HAD a foreground service. It stood it down at every app launch,
 * from resumeMileageTrackingIfEnabled, justified as:
 *
 *     "two location foreground services is double battery for one stream"
 *
 * The premise is false. The WebView watcher is not a foreground service. So
 * the handoff was protected-to-unprotected, and on a geofence resurrection
 * it fired at the START of a drive. One of the resulting kills left 17.5
 * hours with zero location points across a working day.
 *
 * These are static assertions for the same reason as heartbeat-timer's: no
 * behavioural test catches "someone moved the stand-down back to launch".
 * It is a question about WHERE a call sits, so the test asks exactly that.
 */

const TRACKER = "lib/mileage/native-tracker.ts";
const GEOFENCE = "lib/mileage/geofence.ts";

/**
 * Strip comments, so these assertions read CODE and not prose.
 *
 * Necessary here rather than fastidious: the function this test guards
 * carries a long comment explaining why stopGeofenceCapture() was removed
 * from it, and a naive substring search matches that explanation and fails
 * on the very state it is supposed to accept.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Body of a top-level exported function, up to the next top-level one. */
function functionBody(src: string, name: string): string {
  const start = src.indexOf(`export async function ${name}`);
  if (start === -1) throw new Error(`${name} not found — test is stale`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\nexport (async )?function /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the drive foreground service is released on drive end, not app start", () => {
  const tracker = readFileSync(TRACKER, "utf8");

  it("resumeMileageTrackingIfEnabled does not stand the capture down", () => {
    const body = stripComments(
      functionBody(tracker, "resumeMileageTrackingIfEnabled"),
    );
    // Guard the extractor itself: if it silently returned nothing, every
    // assertion below would pass while checking air.
    expect(body.length).toBeGreaterThan(500);
    // Sanity anchor for the extractor, not the subject of this test. The
    // drains moved behind drainNativeBuffers (lib/mileage/native-drain.ts)
    // so they share one re-entrancy guard; the launch drain still happens.
    expect(body).toContain("drainNativeBuffers");

    expect(
      body.includes("stopGeofenceCapture"),
      "App launch must NOT release process protection. On a geofence " +
        "resurrection, launch IS the start of a drive, so releasing here " +
        "drops the process to CACHED exactly when the drive begins.",
    ).toBe(false);
  });

  it("the drive-end path releases it, after the flush is confirmed", () => {
    expect(tracker).toContain("stopGeofenceCapture()");
    const at = tracker.indexOf("void stopGeofenceCapture()");
    expect(at).toBeGreaterThan(-1);
    // Must sit after a confirmed flush, not before. Releasing the process
    // while it still holds the only copy of the drive that just ended is
    // how you lose the drive you were protecting.
    const before = tracker.slice(0, at);
    const lastFlush = before.lastIndexOf("flush({ sessionEnded: true })");
    const lastOkGate = before.lastIndexOf("if (ok)");
    expect(lastFlush).toBeGreaterThan(-1);
    expect(
      lastOkGate,
      "stand-down must be inside the post-flush success branch",
    ).toBeGreaterThan(lastFlush);
  });

  it("driving fixes request protection", () => {
    expect(tracker).toContain("startGeofenceCapture()");
  });

  it("startCapture is feature-detected, because old binaries lack it", () => {
    // A remote-URL WebView routinely runs new JS against an older native
    // shell. Calling an absent plugin method throws, and this one runs on
    // every driving fix, so an unguarded call would break tracking on
    // exactly the devices that have not updated.
    const geo = readFileSync(GEOFENCE, "utf8");
    expect(geo).toContain("startCapture?(");
    expect(geo).toMatch(/plugin\??\.\s*startCapture\b|!plugin\?\.startCapture/);
  });
});
