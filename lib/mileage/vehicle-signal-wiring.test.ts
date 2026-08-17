import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Call-site guard for the vehicle-signal drain.
 *
 * WHAT THIS EXISTS TO PREVENT, measured rather than imagined.
 *
 * `drainVehicleSignals`, `clearVehicleSignals`, `queryMotionHistory` and
 * `auditCaptureGap` were exported from lib/mileage/device-status.ts,
 * bridged in ios/App/App/TaxotticDeviceStatusPlugin.swift, registered on
 * a working bridge, and had ZERO callers anywhere in the tree. Four
 * functions, fully built, permanently inert. In the two days before this
 * was written the same shape produced five other instances: iOS plugins
 * registered but never invoked, a push entitlement wrong by one word for
 * six weeks, a fabricated-mileage gate wired but unguarded,
 * instrumentation holding an answer nobody read for nine days, and two
 * native drain functions with exactly one caller each.
 *
 * A unit test on the collector cannot catch this. The collector passes
 * its own tests whether or not anything calls it. Only a check on the
 * CALL SITE can, which is what this file is.
 *
 * EVERY ASSERTION BELOW RUNS AGAINST COMMENT-STRIPPED SOURCE. This repo
 * has three times shipped a guard that matched a doc comment rather than
 * code: see the self_check note in device-stall.test.ts. Prose satisfying
 * a guard meant to check code is not a hypothetical failure here.
 */

const TRACKER = "lib/mileage/native-tracker.ts";
const ROUTE = "app/api/mileage/heartbeat/route.ts";

/** Source with block and line comments removed. Nothing below may be
 *  satisfied by a comment. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** The body of a named top-level function, comments already stripped. */
function bodyOf(src: string, signature: string): string {
  const start = src.indexOf(signature);
  if (start === -1) {
    throw new Error(`${signature} not found — this guard is stale`);
  }
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i);
  }
  throw new Error(`${signature} never closes — this guard is stale`);
}

describe("the heartbeat actually runs the drain", () => {
  const src = code(TRACKER);
  const beat = bodyOf(src, "export async function sendHeartbeat(");

  it("finds the function it is meant to check", () => {
    // Guards the guard: a renamed or moved sendHeartbeat would make
    // every assertion below vacuous, and vacuous is exactly how the
    // original defect survived.
    expect(beat.length).toBeGreaterThan(1000);
  });

  it("calls collectVehicleSignals from inside sendHeartbeat", () => {
    // Not merely somewhere in the file. A call in a helper that nothing
    // reaches is the failure mode, not the fix.
    expect(
      beat,
      "sendHeartbeat is the only path proven to execute in the field " +
        "(497 iOS beats and 41 Android beats over 7 days). A drain wired " +
        "anywhere else has to prove its own liveness first.",
    ).toContain("collectVehicleSignals(");
  });

  it("is registered as the heartbeat sender, so something calls it", () => {
    expect(src).toMatch(/registerHeartbeatSender\(/);
    expect(src).toMatch(/sendHeartbeat\(\)/);
  });

  it("sends the drained signals to the server", () => {
    expect(beat).toContain("vehicleSignals");
    expect(beat).toContain("vehicleProbe");
  });

  it("acknowledges the native buffer only after the POST", () => {
    // Read, then act, then acknowledge. clearVehicleSignals before the
    // response would delete the evidence of a missed drive on every
    // failed upload, which is the one outcome worse than no data.
    const post = beat.indexOf("/api/mileage/heartbeat");
    const clear = beat.indexOf("clearVehicleSignals(");
    expect(post, "the heartbeat POST moved").toBeGreaterThan(-1);
    expect(clear, "nothing acknowledges the drained buffer").toBeGreaterThan(
      -1,
    );
    expect(
      clear,
      "clearVehicleSignals runs before the server has accepted the data",
    ).toBeGreaterThan(post);
  });

  it("gates the acknowledge on the response being ok", () => {
    // Read the CONDITION that actually guards the call, not a window of
    // nearby text.
    //
    // The first version of this test scanned the 400 characters before
    // clearVehicleSignals for /res\.ok/. Deleting `res.ok &&` from the
    // guard left it green, because writeHeartbeatDiag(res.ok ? ...) sits
    // a few lines above. It was reading a neighbour and reporting on the
    // guard. Third vacuous-guard variant found by mutating this file's
    // own assertions.
    const clear = beat.indexOf("clearVehicleSignals(");
    expect(clear, "nothing acknowledges the drained buffer").toBeGreaterThan(
      -1,
    );
    const condition = beat.slice(
      beat.lastIndexOf("if (", clear),
      clear,
    );
    expect(
      condition,
      "clearVehicleSignals is not guarded by the response being ok, so a " +
        "rejected upload would still delete the evidence it failed to send",
    ).toMatch(/res\.ok/);
  });
});

describe("the server stores what the drain sent", () => {
  const src = code(ROUTE);

  it("finds the route it is meant to check", () => {
    expect(src.length).toBeGreaterThan(1000);
    expect(src).toContain("const payload = {");
  });

  it("validates the observations instead of trusting the device", () => {
    // The client controls this payload end to end. parseSignalReport is
    // the only thing between an arbitrary JSON blob and a stored column.
    expect(src).toContain("parseSignalReport(");
  });

  it("writes the drained signals into the payload both tables receive", () => {
    // Asserted on parsed KEYS, not on substrings.
    //
    // The first version of this test used toContain() against the
    // payload text, and a mutation renaming `vehicle_probe:` to
    // `vehicle_probe_REMOVED:` left it green, because the new name
    // contains the old one. That is the same vacuous-guard failure this
    // file's header describes, reproduced by the guard's own author on
    // the first attempt.
    const payload = bodyOf(src, "const payload = {");
    const keys = [...payload.matchAll(/^\s*([a-z_][a-z0-9_]*)\s*:/gm)].map(
      (mm) => mm[1],
    );
    expect(keys.length, "the payload literal moved").toBeGreaterThan(20);
    for (const column of [
      "vehicle_probe",
      "vehicle_probe_ms",
      "vehicle_signals",
      "motion_available",
      "motion_authorization",
      "motion_audit_status",
      "motion_audit_window_s",
      "motion_gap_automotive_ms",
    ]) {
      expect(keys, `${column} is never written`).toContain(column);
    }
  });
});
