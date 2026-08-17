import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * THE INVARIANT: the native on-disk buffer is drained by events that
 * happen while the app is ALIVE, not only by the app being launched.
 *
 * This is a call-site test, deliberately, because a missing call site is
 * the entire defect. `drainGeofenceBuffer()` and
 * `drainNativeLocationBuffer()` were both correct, both tested, and both
 * had exactly one caller apiece, inside the tracker start path. So the
 * buffer emptied on cold start and at no other time, and upload latency
 * was bounded by when the driver next opened the app: p90 of 24 hours,
 * with `geofence_buffered_fixes` observed climbing to 1512 while the JS
 * layer was provably healthy. No unit test of either drain function can
 * catch that; each one passes in isolation every single time. See
 * docs/design/upload-latency.md.
 *
 * Comments are stripped before every assertion. This repo has twice
 * shipped a guard that matched a doc COMMENT while the code did
 * something else, and the files under test here are heavily commented,
 * including comments that name the very functions being searched for.
 */

const MILEAGE_DIR = "lib/mileage";
const TRACKER = join(MILEAGE_DIR, "native-tracker.ts");
const COORDINATOR = join(MILEAGE_DIR, "native-drain.ts");
const NATIVE_INIT = "components/CapacitorNativeInit.tsx";

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Body of a top-level function, up to the next top-level one. */
function functionBody(src: string, name: string): string {
  const start = src.search(
    new RegExp(`export (async )?function ${name}\\b|^(async )?function ${name}\\b`, "m"),
  );
  if (start === -1) throw new Error(`${name} not found, test is stale`);
  const rest = src.slice(start + 1);
  const next = rest.search(/\n(export )?(async )?function /);
  return next === -1 ? rest : rest.slice(0, next);
}

const tracker = stripComments(readFileSync(TRACKER, "utf8"));

describe("the native buffer is drained outside cold start", () => {
  it("drains from the location callback, the one event a backgrounded app still gets", () => {
    // The load-bearing trigger. A backgrounded WebView freezes
    // setInterval while native location callbacks keep arriving, and
    // this codebase has measured timer_lag_ms of fifteen hours. A drain
    // wired only to the flush interval would be dead for exactly the
    // hours the backlog accumulates.
    //
    // Anchored to the buffer push so this cannot pass by matching the
    // import or some unrelated mention elsewhere in a 2200-line file.
    const at = tracker.indexOf("buffer.push(pt)");
    expect(at, "the location callback moved, test is stale").toBeGreaterThan(-1);
    const callbackTail = tracker.slice(at, at + 1500);
    expect(
      callbackTail,
      "without this the drain cannot run while the app is backgrounded",
    ).toContain("drainNativeBuffers(");
  });

  it("drains from the flush loop", () => {
    const at = tracker.indexOf("flushTimer = setInterval(");
    expect(at).toBeGreaterThan(-1);
    expect(tracker.slice(at, at + 600)).toContain("drainNativeBuffers(");
  });

  it("still drains on app launch", () => {
    const body = stripComments(
      functionBody(readFileSync(TRACKER, "utf8"), "resumeMileageTrackingIfEnabled"),
    );
    // Guard the extractor: a silently empty body makes every assertion
    // below pass while checking nothing.
    expect(body.length).toBeGreaterThan(500);
    expect(body).toContain("drainNativeBuffers(");
  });

  it("drains on resume, because resume re-enters the launch path", () => {
    // The design doc claims a resume from background does not drain and
    // only a cold page load does. The first half is wrong: installAppStateWatch
    // indeed does not drain, but CapacitorNativeInit registers its own
    // appStateChange listener that calls resumeMileageTrackingIfEnabled,
    // which does. That listener is therefore load-bearing for the resume
    // drain and is pinned here rather than duplicated.
    const init = stripComments(readFileSync(NATIVE_INIT, "utf8"));
    const at = init.indexOf('addListener("appStateChange"');
    expect(at, "the resume listener moved, test is stale").toBeGreaterThan(-1);
    // Scoped to THIS handler, up to the next listener registration. The
    // App "resume" listener sits directly below and calls the same
    // function, so a wider window passes even with the appStateChange
    // handler gutted.
    const next = init.indexOf("addListener(", at + 1);
    const handler = init.slice(at, next === -1 ? at + 400 : next);
    expect(handler).toContain("resumeMileageTrackingIfEnabled");
  });
});

describe("a drain outside cold start is visible in production", () => {
  const HEARTBEAT_ROUTE = "app/api/mileage/heartbeat/route.ts";
  const route = stripComments(readFileSync(HEARTBEAT_ROUTE, "utf8"));
  const migrations = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join("supabase/migrations", f), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, "");

  it("still reports the backlog counter this whole change is measured by", () => {
    // geofence_buffered_fixes is the smoking gun in the investigation and
    // it is the number that has to fall. Losing it would leave the fix
    // unfalsifiable.
    expect(tracker).toContain("geofenceBufferedFixes");
    expect(route).toContain("geofence_buffered_fixes");
  });

  it("reports which event caused the last drain", () => {
    expect(tracker).toContain("nativeDrainDiag.lastTrigger");
    expect(route).toContain("native_drain_trigger");
  });

  it("reports how many points that drain moved", () => {
    // Separates "the drain runs and finds nothing" from "the drain never
    // runs". The backlog counter alone cannot tell those apart, and they
    // are completely different bugs.
    expect(tracker).toContain("nativeDrainDiag.lastPoints");
    expect(route).toContain("native_drain_points");
  });

  it("has somewhere to store both, on both heartbeat tables", () => {
    // A payload key with no column is silently dropped by PostgREST, which
    // is how three layers of correct-looking implementation have delivered
    // zero rows in this repo before.
    for (const table of [
      "mileage_device_status",
      "mileage_device_heartbeats",
    ]) {
      const at = migrations.indexOf(`alter table public.${table}\n  add column if not exists native_drain_trigger`);
      expect(at, `${table} has no native_drain_trigger column`).toBeGreaterThan(-1);
      expect(
        migrations.slice(at, at + 300),
        `${table} has no native_drain_points column`,
      ).toContain("native_drain_points");
    }
  });
});

describe("every drain goes through the one guarded chokepoint", () => {
  it("no caller reaches the drain functions directly", () => {
    // What makes the in-flight guard and the wall-clock interval in
    // native-drain.ts actually mean something. A second, ungated call
    // site anywhere reintroduces the overlapping-drain double post, and
    // the guard would still look correct while covering nothing.
    const files = readdirSync(MILEAGE_DIR)
      .map((f) => join(MILEAGE_DIR, f))
      .filter((p) => statSync(p).isFile())
      .filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"));
    expect(files.length, "the glob matched nothing").toBeGreaterThan(5);

    const DEFINITION = /export async function drain(GeofenceBuffer|NativeLocationBuffer)/;
    const CALL = /\bdrain(GeofenceBuffer|NativeLocationBuffer)\s*\(/;

    const callers = files.filter((p) => {
      if (p === COORDINATOR) return false;
      const code = stripComments(readFileSync(p, "utf8"));
      // The file that DEFINES a drain names it too; that is not a call.
      return CALL.test(code.replace(DEFINITION, ""));
    });

    expect(
      callers,
      "these call a native drain without going through " +
        "drainNativeBuffers, so they are not covered by its in-flight " +
        "guard and can double-post the same fixes",
    ).toEqual([]);
  });
});
