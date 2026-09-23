import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * THE INVARIANT: the native uploader has a caller.
 *
 * A built, bridged, never-called function is this repository's signature
 * failure. TaxotticDeviceStatusPlugin was correct and dead for weeks,
 * four iOS functions needed a PR of their own just to acquire a caller,
 * and the buffer latency Task 3 exists to fix was diagnosed as "a
 * missing call site, not an OS constraint". TaxotticUploader is tested
 * three ways already (lib/mileage/native-uploader.test.ts reads its
 * source, TaxotticUploaderTest.java executes it, and both pass with the
 * whole class unreachable). None of that moves a single fix off a phone
 * until the capture service calls it.
 *
 * So this file asserts the call, its two moments, and the fact that the
 * outcome is written somewhere a reader can query. It is a source
 * guard, deliberately: a behavioural test would need a real Service
 * lifecycle, and the failure that actually happens here is nobody
 * calling the thing at all, which no behavioural test of the callee can
 * ever see.
 *
 * Comments are stripped before every assertion. This repo has twice
 * shipped a guard that matched a doc COMMENT while the code did
 * something else, and the Java under test here is heavily commented,
 * including comments that name the very symbols searched for.
 */

const SERVICE =
  "android/app/src/main/java/com/taxottic/app/TaxotticResurrectionService.java";
const STORE = "android/app/src/main/java/com/taxottic/app/TaxotticGeofenceStore.java";
const TRACKER = "lib/mileage/native-tracker.ts";
const GEOFENCE_TS = "lib/mileage/geofence.ts";
const HEARTBEAT_ROUTE = "app/api/mileage/heartbeat/route.ts";

/** Java or TypeScript source with comments removed. */
function withoutComments(src: string): string {
  let out = "";
  let inString = false;
  let i = 0;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (!inString && two === "//") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (!inString && two === "/*") {
      i += 2;
      while (i < src.length && src.slice(i, i + 2) !== "*/") i++;
      i += 2;
      continue;
    }
    if (src[i] === '"' && src[i - 1] !== "\\") inString = !inString;
    if (src[i] === "\n") inString = false;
    out += src[i];
    i++;
  }
  return out;
}

/** The body of a method, from its signature to the closing brace at its indent. */
function methodBody(code: string, signature: string): string {
  const at = code.indexOf(signature);
  expect(at, `${signature} is missing`).toBeGreaterThan(-1);
  const open = code.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    if (code[i] === "}") {
      depth--;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  throw new Error(`${signature} is never closed`);
}

const service = withoutComments(readFileSync(SERVICE, "utf8"));
const store = withoutComments(readFileSync(STORE, "utf8"));

describe("the capture service actually calls the uploader", () => {
  it("calls it at all", () => {
    // The whole point of the task. If this line ever fails, every fix
    // captured by the resurrection path is sitting on the phone waiting
    // for the driver to open the app, which is the 5.9 day p90.
    expect(
      service,
      "the service never calls TaxotticUploader, so the uploader is dead code",
    ).toContain("TaxotticUploader.uploadInBackground(");
  });

  it("never calls the blocking overload from a lifecycle method", () => {
    // upload(Context) has a 15s connect and a 30s read timeout. Every
    // caller in this file is the main thread, where that is an ANR, and
    // the OS resolves an ANR by killing the process mid-upload.
    const blocking = service.match(/TaxotticUploader\.upload\s*\(/g) ?? [];
    expect(
      blocking,
      "the service calls the blocking upload() directly; use uploadInBackground",
    ).toEqual([]);
  });

  /**
   * Moment one. The buffer is final the instant a capture is marked
   * finished, and the service is still holding foreground importance at
   * that point, which is the only state in which the OS reliably lets
   * this process finish a network round trip.
   *
   * Anchored inside stopWithState rather than to the file, because that
   * is the single funnel every deliberate end passes through: stationary
   * stop, session cap, handoff to the WebView tracker, provider off and
   * give-up while blind.
   */
  it("uploads when a capture ends", () => {
    const stop = methodBody(service, "private void stopWithState(String state, String detail)");
    expect(
      stop,
      "no upload where the service marks a capture finished",
    ).toContain("uploadBufferedFixes(");
    expect(stop, "the capture-ended trigger is not named").toContain('"capture_ended"');
    // Before stopSelf, so the work is submitted while the service is
    // still a foreground service rather than during teardown.
    expect(stop.indexOf("uploadBufferedFixes(")).toBeLessThan(stop.indexOf("stopSelf()"));
  });

  /**
   * Moment two, and the one that owns the tail. A cold start after an
   * overnight kill is the first moment in hours that this process exists
   * at all, and whatever the last session buffered is still on disk.
   */
  it("uploads when it starts holding a backlog", () => {
    const start = methodBody(
      service,
      "public int onStartCommand(Intent intent, int flags, int startId)",
    );
    expect(start, "nothing drains the backlog on a cold start").toContain(
      "uploadBufferedFixes(",
    );
    expect(start).toContain('"cold_start_backlog"');
    // Guarded: an empty buffer is not worth waking the radio for.
    expect(start).toMatch(
      /countBufferedFixes\(\s*this\s*\)\s*>\s*0[\s\S]{0,120}uploadBufferedFixes\(/,
    );
    // After the foreground promotion. Submitting work from a service
    // that then fails to promote is work inside a process the platform
    // is about to kill for missing the startForeground deadline.
    expect(start.indexOf("promoteToForeground(")).toBeLessThan(
      start.indexOf("uploadBufferedFixes("),
    );
  });

  it("uploads at those two moments and no others", () => {
    // Two call sites plus the helper's own definition. A third would
    // mean somebody added a timer, which is what the next test rejects
    // by name, or a per-fix upload, which would hold the radio awake
    // for the whole drive.
    const sites = service.match(/uploadBufferedFixes\(/g) ?? [];
    expect(sites, "the upload is triggered from somewhere new").toHaveLength(3);
  });

  it("has no timer driving the upload", () => {
    // The service already has a lifecycle. A periodic upload would keep
    // the radio awake across a whole drive to move points that are not
    // finished being captured yet, and this device's last four process
    // deaths were all LOW_MEMORY.
    const helper = methodBody(service, "private void uploadBufferedFixes(String trigger)");
    expect(helper).not.toContain("postDelayed");
    expect(helper).not.toContain("scheduleAtFixedRate");
    expect(service).not.toMatch(/postDelayed\([^)]*upload/i);
  });
});

describe("the outcome of every upload is recorded", () => {
  /**
   * The riskiest unverified assumption in this whole change is that
   * CookieManager.getInstance().getCookie(origin) returns the Supabase
   * session cookie inside a process started cold by a geofence receiver,
   * which has never created a WebView. If it does not, every run returns
   * "no_session", nothing is posted, and the latency does not move at
   * all. No test in this repository can answer that: it needs a phone.
   *
   * What can be guaranteed here is that the answer arrives. The reason
   * string has to survive from the uploader's Result to a column, or the
   * build ships and we still cannot tell a working uploader from a dead
   * one.
   */
  it("hands the uploader a listener that records the reason", () => {
    const helper = methodBody(service, "private void uploadBufferedFixes(String trigger)");
    expect(helper).toContain("TaxotticGeofenceStore.recordUpload(");
    expect(helper, "the reason is dropped, which is the only signal we get").toMatch(
      /recordUpload\([\s\S]*?\.reason/,
    );
    expect(helper, "the posted count is dropped").toMatch(/recordUpload\([\s\S]*?\.posted/);
    expect(helper, "the trigger is dropped").toMatch(/recordUpload\([\s\S]*?trigger/);
  });

  it("stores it durably, because the process is usually dead by the next heartbeat", () => {
    const record = methodBody(
      store,
      "static void recordUpload(Context context, String trigger, int posted, String reason)",
    );
    expect(record).toMatch(/\.put\(\s*"trigger"/);
    expect(record).toMatch(/\.put\(\s*"posted"/);
    expect(record).toMatch(/\.put\(\s*"reason"/);
    // SharedPreferences, the same store the capture state already
    // survives a process kill in.
    expect(record).toContain("prefs(context)");
  });

  it("puts it in the snapshot the bridge reads, next to lastCapture", () => {
    // snapshot() is what TaxotticGeofencePlugin.getState resolves. A
    // value written to prefs and left out of here reaches nobody.
    const snapshot = methodBody(store, "static JSONObject snapshot(Context context)");
    expect(snapshot, "lastUpload never leaves the device").toContain('"lastUpload"');
  });
});

describe("the reason reaches a column a reader can query", () => {
  const tracker = withoutComments(readFileSync(TRACKER, "utf8"));
  const geofenceTs = readFileSync(GEOFENCE_TS, "utf8");
  const route = withoutComments(readFileSync(HEARTBEAT_ROUTE, "utf8"));
  const migrations = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join("supabase/migrations", f), "utf8"))
    .join("\n")
    .replace(/--[^\n]*/g, "");

  it("is typed on the state the plugin resolves", () => {
    // Without the field on GeofenceState, the tracker cannot read it and
    // tsc says so, which is the cheapest possible failure.
    expect(geofenceTs).toContain("lastUpload");
  });

  it("is sent on the heartbeat", () => {
    expect(tracker).toContain("nativeUploadReason");
    expect(tracker).toContain("nativeUploadTrigger");
    expect(tracker).toContain("nativeUploadPoints");
    expect(tracker).toMatch(/nativeUploadReason:\s*geofence\?\.lastUpload/);
  });

  it("is mapped by the route", () => {
    expect(route).toContain("native_upload_reason");
    expect(route).toContain("native_upload_trigger");
    expect(route).toContain("native_upload_points");
  });

  it("has somewhere to land, on both heartbeat tables", () => {
    // A payload key with no column is dropped SILENTLY by PostgREST,
    // which is how three layers of correct-looking implementation have
    // delivered zero rows in this repo before. Worse on
    // mileage_device_status: the route upserts that one first and
    // returns 500 on error, so a column present on only the history
    // table does not degrade the heartbeat, it deletes it for every
    // device on both platforms.
    for (const table of ["mileage_device_status", "mileage_device_heartbeats"]) {
      const at = migrations.indexOf(
        `alter table public.${table}\n  add column if not exists native_upload_reason`,
      );
      expect(at, `${table} has no native_upload_reason column`).toBeGreaterThan(-1);
      const block = migrations.slice(at, at + 400);
      expect(block, `${table} has no native_upload_trigger column`).toContain(
        "native_upload_trigger",
      );
      expect(block, `${table} has no native_upload_points column`).toContain(
        "native_upload_points",
      );
    }
  });

  it("keeps the reason vocabulary the uploader actually emits", () => {
    // The column is only worth querying if the values are the ones
    // TaxotticUploader.Result can hold. Named here so a rename on
    // either side breaks loudly instead of producing a column full of
    // strings nobody recognises.
    const uploader = withoutComments(
      readFileSync("android/app/src/main/java/com/taxottic/app/TaxotticUploader.java", "utf8"),
    );
    for (const reason of ["ok", "no_config", "no_session", "bad_origin", "empty", "io_error"]) {
      expect(uploader, `the ${reason} reason is gone`).toContain(`"${reason}"`);
    }
    expect(uploader).toContain('"http_"');
  });
});
