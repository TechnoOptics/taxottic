import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

/**
 * The Android capture service has to be able to post its own buffered
 * fixes with no JavaScript running.
 *
 * Measured over 21 days on the reporting phone, the median GPS fix
 * reached the server 24 hours after it was captured and p90 was 5.9
 * days. The cause is not the network: the only uploader in the product
 * is the WebView flush tick, and the OS kills the app nightly, so a
 * buffer filled at 07:00 waits for the driver to open the app. The
 * native uploader exists to close that gap, and it only closes it if
 * four properties hold.
 *
 * None of them can be proved by any automated run in this repository
 * today. `android/app/src/test/` compiles under Gradle, and CI runs
 * `compileDebugJavaWithJavac`, which does not compile test sources; the
 * `androidTest` tree needs a device nothing in CI provides. So this
 * file asserts the four properties against the Java bytes from the
 * vitest suite, the same technique as
 * `ios-location-services-mainthread.test.ts` and
 * `plugin-registration.test.ts`.
 *
 * What it can and cannot catch is spelled out per test. In short: it
 * catches a wrong ORDER, a missing FLAG, a missing GUARD and a missing
 * THREAD HOP, which are the four ways this file has plausibly been got
 * wrong. It cannot catch a runtime failure: a store that hands back the
 * wrong lines, a cookie the server rejects, or an executor that is
 * never reached because nobody calls the uploader at all (that last one
 * is the call-site guard's job, not this file's).
 */

const UPLOADER = "android/app/src/main/java/com/taxottic/app/TaxotticUploader.java";
const STORE = "android/app/src/main/java/com/taxottic/app/TaxotticGeofenceStore.java";

/**
 * Java source with comments removed.
 *
 * Load-bearing, not tidiness. Every rule below is also DOCUMENTED in a
 * comment in the Java, in the words this file greps for ("backlog",
 * "consume", "2xx"). Asserting on the raw file would let the
 * explanation of a rule stand in for the rule, which is how a guard
 * comes out green over code that does the opposite of what it says.
 */
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

describe("the native uploader posts before it forgets", () => {
  it("exists at all", () => {
    expect(existsSync(UPLOADER), `${UPLOADER} is missing`).toBe(true);
  });

  const code = withoutComments(readFileSync(UPLOADER, "utf8"));
  const upload = methodBody(
    code,
    "static Result upload(Context ctx, CookieSource cookies, CookieSink sink, Transport transport)",
  );

  /**
   * Rule 1, and the one that loses drives if it is broken.
   *
   * `lib/mileage/drain-coverage.ts` exists because two drains posted the
   * same batch, so the server dedupes on (driver, captured_at, lat,
   * lng): a fix posted twice is absorbed, a fix consumed without being
   * posted is gone. The buffer is the only copy.
   *
   * Catches: consuming before the POST, consuming on a thrown IOException,
   * consuming on a 4xx or 5xx, and a second consume site added later.
   * Does not catch: consuming the wrong NUMBER of lines. That is the
   * store's contract and is argued in readBufferedFixes' javadoc, where
   * skipping an unreadable line can only ever leave a posted fix behind
   * (a duplicate), never drop an unposted one.
   */
  it("consumes the buffer only after the POST returned, never before", () => {
    const post = upload.indexOf("transport.post(");
    const consume = upload.indexOf("consumeBuffer(");
    expect(post, "upload() never posts").toBeGreaterThan(-1);
    expect(consume, "upload() never consumes the buffer").toBeGreaterThan(-1);
    expect(
      post,
      "the buffer is consumed before the POST: a failed post would lose the drive",
    ).toBeLessThan(consume);
  });

  it("consumes in exactly one place, so there is one rule to check", () => {
    const sites = code.match(/consumeBuffer\(/g) ?? [];
    expect(sites).toHaveLength(1);
  });

  it("returns without consuming when the status is not 2xx", () => {
    const post = upload.indexOf("transport.post(");
    const consume = upload.indexOf("consumeBuffer(");
    const between = upload.slice(post, consume);
    expect(
      between,
      "nothing between the POST and the consume rejects a non-2xx status",
    ).toMatch(/if\s*\(\s*status\s*<\s*200\s*\|\|\s*status\s*>=\s*300\s*\)[\s\S]*?return/);
  });

  it("returns without consuming when the POST throws", () => {
    const post = upload.indexOf("transport.post(");
    const consume = upload.indexOf("consumeBuffer(");
    const between = upload.slice(post, consume);
    expect(between).toMatch(/catch\s*\(\s*IOException[\s\S]*?return/);
  });

  /**
   * Rule 2. `app/api/mileage/ingest/route.ts` shifts any batch whose
   * newest point is 2 to 30 minutes behind receipt forward to "now",
   * reading the lag as device clock drift. Every fix this uploader
   * sends is stored and forwarded by construction, so its lag is the
   * design. Without the flag a buffered drive is re-stamped on arrival
   * and lands a second time, at a timestamp the idempotency key cannot
   * recognise. That is the exact mechanism behind the 19.3 minute
   * duplicate commute of 2026-08-12.
   *
   * Catches: the flag dropped, renamed, or sent as the string "true".
   * Does not catch: the flag sent on a batch that is not backlog. This
   * uploader has no such batch.
   */
  it("marks every batch as backlog so the server does not re-stamp it", () => {
    expect(upload).toMatch(/\.put\(\s*"backlog"\s*,\s*true\s*\)/);
  });

  it("sends backlog unconditionally, not behind a flag or a branch", () => {
    const flags = code.match(/"backlog"/g) ?? [];
    expect(flags).toHaveLength(1);
    // The put must sit in the same straight-line block that builds the
    // payload, between the companyId and the toString(), rather than
    // inside an if that some later caller can turn off.
    expect(upload).toMatch(
      /\.put\(\s*"companyId"[\s\S]*?\.put\(\s*"backlog"\s*,\s*true\s*\)[\s\S]*?toString\(\)/,
    );
  });

  /**
   * Rule 3. Task 2's config comes from `window.location.origin`. Today
   * the shell loads taxottic.com over https, but a move to bundled
   * assets would make that `capacitor://localhost`, and `new URL()` on
   * it throws inside a background thread where nothing is watching. A
   * named refusal is a diagnosable one.
   *
   * Catches: no scheme check at all, and a check that runs after the
   * POST. Does not catch: an http origin that is not the real server.
   * The cookie jar is the thing that makes a wrong host useless, and
   * that is not decidable from source.
   */
  it("refuses an origin that is not http or https, with its own reason", () => {
    expect(code).toContain("bad_origin");
    expect(upload).toMatch(/startsWith\(\s*"https:\/\/"\s*\)/);
    expect(upload).toMatch(/startsWith\(\s*"http:\/\/"\s*\)/);
    const check = upload.indexOf('"bad_origin"');
    expect(check, "bad_origin is never returned").toBeGreaterThan(-1);
    expect(
      check,
      "the origin is checked after the POST, which is not a check",
    ).toBeLessThan(upload.indexOf("transport.post("));
  });

  /**
   * Rule 4. The uploader is called from a service: `onStartCommand` and
   * the capture-ended path are both the main thread, and a 30 second
   * read timeout there is an ANR, which the OS resolves by killing the
   * process that was mid-upload.
   *
   * Catches: the executor deleted, the work run inline on the caller,
   * and the work posted to the main looper instead. Does not catch: a
   * caller that reaches the blocking `upload(Context)` overload
   * directly from the main thread. That overload is the seam Task 4's
   * call site wraps, and its own guard covers that.
   */
  it("hands the blocking work to a thread of its own", () => {
    expect(code).toMatch(
      /private static final ExecutorService UPLOAD_EXECUTOR\s*=\s*Executors\.newSingleThreadExecutor\(\)/,
    );
    const background = methodBody(
      code,
      "static void uploadInBackground(Context ctx, Listener listener)",
    );
    const submit = background.indexOf("UPLOAD_EXECUTOR.execute(");
    const work = background.indexOf("upload(app)");
    expect(submit, "uploadInBackground does not use the executor").toBeGreaterThan(-1);
    expect(work, "uploadInBackground never uploads").toBeGreaterThan(-1);
    expect(
      submit,
      "the upload runs on the caller's thread, before it is ever submitted",
    ).toBeLessThan(work);
  });

  it("never hops to the main looper", () => {
    expect(code).not.toContain("getMainLooper");
    expect(code).not.toContain("runOnUiThread");
  });

  /**
   * The wire format. `isFinitePoint` in app/api/mileage/ingest/route.ts
   * drops any point that is not {lat, lng, ts} as finite numbers, and it
   * drops them SILENTLY: a batch of stored-shape fixes posts 200 and
   * ingests nothing.
   *
   * Catches: the stored key names leaking onto the wire. Does not catch:
   * a unit error, e.g. seconds where the route wants milliseconds.
   */
  it("posts the point shape the ingest route validates, not the stored shape", () => {
    expect(upload).toMatch(/\.put\(\s*"lat"/);
    expect(upload).toMatch(/\.put\(\s*"lng"/);
    expect(upload).toMatch(/\.put\(\s*"ts"/);
    expect(upload).not.toMatch(/\.put\(\s*"latitude"/);
    expect(upload).not.toMatch(/\.put\(\s*"longitude"/);
    expect(upload).toContain("/api/mileage/ingest");
  });

  it("reads the oldest fixes from the store and converts them there", () => {
    const store = withoutComments(readFileSync(STORE, "utf8"));
    const read = methodBody(
      store,
      "static BufferRead readBufferedFixes(Context context, int max)",
    );
    // The conversion belongs next to appendFix, which owns the stored
    // names, so the two halves of the format cannot drift apart.
    expect(read).toMatch(/\.put\(\s*"lat"\s*,[\s\S]*?getDouble\(\s*"latitude"\s*\)/);
    expect(read).toMatch(/\.put\(\s*"lng"\s*,[\s\S]*?getDouble\(\s*"longitude"\s*\)/);
    expect(read).toMatch(/\.put\(\s*"ts"\s*,[\s\S]*?getLong\(\s*"time"\s*\)/);
    // Oldest first, capped. consumeBuffer drops from the head of the
    // file, so a reader that returned the NEWEST fixes would consume
    // lines it never posted.
    expect(read).toMatch(/out\.size\(\)\s*<\s*max/);
  });
});

/**
 * THE INVARIANT: a lost race costs a duplicate, never a drive.
 *
 * Two consumers drain the one JSONL file and they share a process: the
 * JS drain in lib/mileage/geofence.ts and TaxotticUploader on its own
 * executor. Nothing in AndroidManifest.xml declares android:process, so
 * this is not theoretical. BUFFER_LOCK makes each file operation atomic
 * and does nothing for the read, POST, consume window that both of them
 * straddle.
 *
 * The reviewer's sequence, which needs no appends and no timing luck:
 * 900 buffered; JS reads 900 and posts its first 800; native reads 500,
 * posts, consumes 500, leaving 400; JS then consumes 800 and takes the
 * whole file, including lines 801 to 900, which nobody ever posted.
 *
 * The count is the bug. It says how many lines to drop without saying
 * which buffer they were counted against. Every consume now carries the
 * generation its read saw.
 *
 * TaxotticUploaderTest.java executes this sequence end to end. This
 * file asserts the wiring, because an executed test of the native half
 * cannot see a JS caller that forgets to pass the token.
 */
describe("consuming the buffer is identity-bearing, not count-bearing", () => {
  const store = withoutComments(readFileSync(STORE, "utf8"));
  const code = withoutComments(readFileSync(UPLOADER, "utf8"));
  const geofence = withoutComments(readFileSync("lib/mileage/geofence.ts", "utf8"));

  it("bumps the generation on every append and every consume", () => {
    const append = methodBody(
      store,
      "static boolean appendFix(Context context, Location location, String placeId, String source)",
    );
    expect(append, "an append leaves outstanding tokens looking valid").toContain(
      "BUFFER_GENERATION.incrementAndGet()",
    );
    const consume = methodBody(store, "static void consumeBuffer(Context context, int count)");
    expect(
      consume,
      "a consume leaves the other consumer's token looking valid, which is the loss",
    ).toContain("BUFFER_GENERATION.incrementAndGet()");
  });

  it("refuses a consume whose token no longer matches, without touching the file", () => {
    const guarded = methodBody(
      store,
      "static boolean consumeBuffer(Context context, int count, long generation)",
    );
    expect(guarded).toMatch(/if\s*\(\s*generation\s*!=\s*current\s*\)/);
    // The refusal must come before anything that rewrites the file.
    const refusal = guarded.indexOf("return false");
    const rewrite = guarded.indexOf("consumeBuffer(context, count)");
    expect(refusal, "the stale branch never returns").toBeGreaterThan(-1);
    expect(rewrite, "the guarded overload never consumes").toBeGreaterThan(-1);
    expect(
      refusal,
      "the file is rewritten before the token is checked, so the check is decoration",
    ).toBeLessThan(rewrite);
  });

  it("reads the fixes and the token under one lock", () => {
    // Two locks would hand a caller a token NEWER than its content, and
    // a consume against that token would be accepted although the file
    // had already moved. That is the same loss with extra steps.
    const bridge = methodBody(
      store,
      "static JSONObject readBufferForBridge(Context context) throws JSONException",
    );
    expect(bridge).toMatch(
      /synchronized\s*\(\s*BUFFER_LOCK\s*\)[\s\S]*readBufferLocked\(context\)[\s\S]*BUFFER_GENERATION\.get\(\)/,
    );
    const read = methodBody(store, "static BufferRead readBufferedFixes(Context context, int max)");
    expect(read).toMatch(
      /synchronized\s*\(\s*BUFFER_LOCK\s*\)\s*\{\s*long generation = BUFFER_GENERATION\.get\(\)/,
    );
  });

  it("makes the native uploader consume with the token it read", () => {
    const upload = methodBody(
      code,
      "static Result upload(Context ctx, CookieSource cookies, CookieSink sink, Transport transport)",
    );
    expect(
      upload,
      "the uploader consumes by count alone, which can drop the JS drain's unposted tail",
    ).toMatch(/consumeBuffer\(\s*ctx\s*,\s*fixes\.size\(\)\s*,\s*read\.generation\s*\)/);
  });

  it("makes the JS drain consume with the token it read", () => {
    expect(geofence).toMatch(/const read = await plugin\.readBuffer\(\)/);
    expect(geofence, "the JS drain never reads the token").toMatch(
      /generation = read\?\.generation/,
    );
    expect(
      geofence,
      "the JS drain consumes by count alone, which is the half of the race that loses lines 801 to 900",
    ).toMatch(/consumeBuffer\(\{\s*count:\s*fixes\.length,\s*generation\s*\}\)/);
  });

  it("passes the token across the bridge in both directions", () => {
    const plugin = withoutComments(
      readFileSync("android/app/src/main/java/com/taxottic/app/TaxotticGeofencePlugin.java", "utf8"),
    );
    const read = methodBody(plugin, "public void readBuffer(PluginCall call)");
    expect(read, "readBuffer does not return the token, so JS cannot send one").toMatch(
      /out\.put\(\s*"generation"/,
    );
    const consume = methodBody(plugin, "public void consumeBuffer(PluginCall call)");
    expect(consume).toContain('call.getLong("generation")');
    expect(
      consume,
      "a token that arrives is ignored, so the JS half of the guard does nothing",
    ).toMatch(/consumeBuffer\(\s*\n?\s*getContext\(\),\s*count == null \? 0 : count,\s*generation\)/);
  });
});

/**
 * THE INVARIANT: an upload never costs the driver their session.
 *
 * lib/supabase/middleware.ts calls getUser() BEFORE its /api/ early
 * return, so a POST carrying an expired access token makes the server
 * refresh the session and rotate the refresh token. Rotation is on for
 * this project: 174 refresh tokens over 7 days across 3 sessions, 171
 * of them already revoked. The new pair comes back as Set-Cookie.
 *
 * HttpURLConnection has no CookieHandler installed, so those headers go
 * nowhere by default and the WebView jar keeps a token the server has
 * just revoked. The driver is signed out at the next app open, into the
 * silent 401 loop native-tracker.ts records as having cost a full day
 * of drives. An uploader that does that is worse than no uploader, and
 * nothing about it is visible until a driver is logged out, which is
 * why it is guarded here as well as executed in TaxotticUploaderTest.
 */
describe("the uploader keeps the session it was given", () => {
  const code = withoutComments(readFileSync(UPLOADER, "utf8"));
  const upload = methodBody(
    code,
    "static Result upload(Context ctx, CookieSource cookies, CookieSink sink, Transport transport)",
  );

  it("writes the rotated cookies back, after the post and before the consume", () => {
    const post = upload.indexOf("transport.post(");
    const store = upload.indexOf("sink.store(");
    const consume = upload.indexOf("consumeBuffer(");
    expect(store, "the Set-Cookie headers are dropped, revoking the driver's session").toBeGreaterThan(-1);
    expect(store, "cookies are written before the server has answered").toBeGreaterThan(post);
    // A crash or a refusal in the consume must not be able to lose a
    // session this process just caused the server to rotate.
    expect(store, "the session write back sits behind the consume").toBeLessThan(consume);
  });

  it("only writes them back on a 2xx", () => {
    const post = upload.indexOf("transport.post(");
    const store = upload.indexOf("sink.store(");
    const between = upload.slice(post, store);
    expect(between).toMatch(/if\s*\(\s*status\s*<\s*200\s*\|\|\s*status\s*>=\s*300\s*\)[\s\S]*?return/);
  });

  it("carries the Set-Cookie headers out of the transport at all", () => {
    // A Transport that returns a bare int cannot carry them, which is
    // the shape this started as.
    expect(code).toMatch(/interface Transport \{\s*Response post\(/);
    const headers = methodBody(code, "private static List<String> setCookiesFrom(HttpURLConnection c)");
    expect(headers).toContain('equalsIgnoreCase("Set-Cookie")');
  });

  it("persists the jar to disk, because the process is minutes from death", () => {
    const sink = methodBody(
      code,
      "private static void storeCookies(String origin, List<String> setCookies)",
    );
    expect(sink).toContain("setCookie(origin, value)");
    expect(sink, "the rotation lives in memory and dies with the process").toContain("flush()");
  });

  /**
   * A 301 or 302 in front of the route is followed AS A GET by default,
   * returns 200 from an HTML page, and the buffer is consumed with
   * nothing ingested. Silent, and indistinguishable from success in
   * every column we record.
   */
  it("never follows a redirect", () => {
    const http = methodBody(
      code,
      "private static Response httpPost(String url, String cookie, String body) throws IOException",
    );
    expect(http, "a redirect is followed as a GET and its 200 consumes the buffer").toContain(
      "setInstanceFollowRedirects(false)",
    );
    // And the 3xx that now surfaces must fail, which the 2xx-only gate
    // above already covers; assert the gate has not been widened.
    expect(upload).toMatch(/status\s*>=\s*300/);
  });

  /**
   * "The driver is signed out" and "the WebView provider will not load
   * in this process" want opposite responses: sign in again, versus
   * stop shipping this design. One word for both is how a dead feature
   * reads as a user problem.
   */
  it("distinguishes an unavailable cookie jar from an empty one", () => {
    expect(code).toContain("no_cookie_jar");
    expect(code).toContain("no_session");
    const systemCookie = methodBody(code, "private static String systemCookie(String origin)");
    expect(systemCookie, "a provider failure is swallowed as a missing session").toContain(
      "throw new CookieJarUnavailable(t)",
    );
    expect(upload).toMatch(/catch\s*\(\s*CookieJarUnavailable[\s\S]*?"no_cookie_jar"/);
  });
});
