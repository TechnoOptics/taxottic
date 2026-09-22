# PR 5, the native layer: Android uploads its own drives

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Android drive reaches the server without the driver opening the app, and device health stops reporting a live plugin as dead.

**Architecture:** The Android capture service already holds the fixes and already runs as a foreground service. It gains the ability to POST them itself, authenticated with the session cookie the WebView already holds, so a phone the OS killed is no longer a phone whose drives are stranded. Separately, the health probe that feeds `self_check` learns to say why a read returned nothing, so a two second timeout stops being reported as a dead plugin. The remaining platform items from the 2026-09-14 audits (iOS back gesture, associated domains, backup flag, channel importance, picker theme) ride the same store build.

**Tech Stack:** Capacitor 8, Android Java (`android/app/src/main/java/com/taxottic/app`), iOS Swift + entitlements, Next.js 16 API routes, Supabase (RLS), vitest source guards, Playwright.

## Why this plan differs from the one the audit synthesis sketched

The synthesis scoped PR 5 around "drives go dark on Android because nothing native uploads", and `docs/design/upload-latency.md` answers that with "**Do not start at B**": ship Option A (drain the buffer from the flush tick) and only reconsider a native uploader "for Android, and only if the post-A p90 still justifies it".

Option A shipped on 2026-08-17 as [#593](https://github.com/TechnoOptics/taxottic/pull/593). Measured today over 21 days of `mileage_points_raw`, lag being `created_at - captured_at`:

| Device | Points | p50 | p90 | p99 |
| --- | --- | --- | --- | --- |
| Android (1.3.11) | 33,124 | 24.3 hours | 5.9 days | 6.3 days |
| iOS (1.3.12) | 2,563 | 1.2 min | 16.3 min | 57 min |

The doc's own gate is therefore met, and met only where it predicted: Android. iOS is healthy and gets no uploader, exactly as the doc argued it should not. This plan builds Option B for Android alone.

Two further facts from the same telemetry shape the work:

- The Android phone reports `self_check = "dead=geofence_plugin"` while the same plugin reported `armState = "armed"` on 163 heartbeats between 2026-08-24 and 2026-09-15. The verdict is a false alarm, produced by Task 1's bug below. Fixing it comes first because every later judgement about this phone is read through that signal.
- The native side has no idea which company a fix belongs to. `syncPlaces` pushes places down and nothing pushes `companyId`, so the uploader has to be given one before it can post anything.

## Global Constraints

- No em dashes (U+2014) anywhere: code, comments, copy, commit messages, PR body. No emoji. No "Generated with Claude Code" footer on the PR body; say in one line that the repo's rules take precedence.
- Commit messages end with the exact line `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- Icons are stroke SVGs from `components/ui/Icons` on web, Ionicons on mobile. Never emoji as an icon.
- Supabase: SELECT only through the MCP, schema changes only through `apply_migration`. Never edit the Techno Optics fleet contract files.
- Never use bare `git stash`: the stack is shared across worktrees. Commit before mutation-probing a file, because `git checkout --` as a probe undo also destroys uncommitted work in it.
- `public/sw.js` `CACHE_VERSION` is bumped once, in Task 9, chosen against `origin/main` and every open PR at that moment. Today that is v204 on main and v205 to v209 in the open stack, so v210 unless something took it. Keep every changelog entry.
- Work in `/Users/technooptics/Projects/taxottic-wt/native-layer` on `feat/native-layer`, based on `origin/main` (1e2ce98) rather than on the design stack, so this can merge ahead of five queued design PRs.
- Tasks 1 and 7's web half ship with the web. Tasks 2 to 6 and 8 need an Android or iOS build the owner cuts; nothing in them may break the web build.

---

### Task 1: The geofence probe says why it returned nothing

**Files:**
- Modify: `lib/mileage/geofence.ts` (add `probeGeofenceState`), `lib/mileage/native-tracker.ts:1085` and its two payloads, `lib/mileage/self-check.ts:179-192`, `app/api/mileage/heartbeat/route.ts`
- Test: `lib/mileage/self-check.test.ts`, `lib/mileage/geofence-probe.test.ts` (create)
- Migration: `supabase/migrations/` via `apply_migration`

**Interfaces:**
- Produces: `probeGeofenceState(): Promise<{ value: GeofenceState | null; outcome: GeofenceProbeOutcome }>` and `type GeofenceProbeOutcome = "ok" | "absent" | "error"`. The call site adds `"timeout"` through the existing `probeWithin`, giving the same five-value vocabulary as `DeviceProbeOutcome` in `lib/mileage/device-status.ts:347`.
- Produces: `SelfCheckProbe.geofenceProbe: string | null` consumed by `lib/mileage/self-check.ts`.

- [ ] **Step 1: Write the failing self-check test**

```ts
// lib/mileage/self-check.test.ts, in the geofence describe
it("a geofence read that timed out is unknown, never dead", () => {
  const out = runSelfCheck({
    ...baseProbe,
    native: true,
    probed: true,
    geofenceProbe: "timeout",
    geofenceArmState: null,
  });
  const plugin = out.find((c) => c.id === "geofence_plugin")!;
  expect(plugin.verdict, "a timeout is not evidence of death").toBe("unknown");
  expect(plugin.builtButDead).toBe(false);
});

it("a geofence plugin that is genuinely absent is dead", () => {
  const out = runSelfCheck({
    ...baseProbe,
    native: true,
    probed: true,
    geofenceProbe: "absent",
    geofenceArmState: null,
  });
  expect(out.find((c) => c.id === "geofence_plugin")!.verdict).toBe("dead");
});
```

Use the file's existing helper names for `runSelfCheck` and `baseProbe`; read the top of `lib/mileage/self-check.test.ts` first and match them exactly.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run lib/mileage/self-check.test.ts`
Expected: FAIL. The timeout case currently returns `"dead"`, because `lib/mileage/self-check.ts:182` treats any null arm state with `probed` true as death.

- [ ] **Step 3: Add the probe to geofence.ts**

```ts
// lib/mileage/geofence.ts, replacing getGeofenceState's body is NOT the
// move: keep it, and add the probing sibling beside it so existing
// callers are untouched.

/**
 * Why a geofence read came back empty.
 *
 * `getGeofenceState` collapses three different worlds into one null:
 * the plugin is not registered, the plugin threw, and the call never
 * came back. The first is our bug and the other two are not, and the
 * health check has been reporting all three as death. 163 heartbeats
 * from one Android phone carried armState "armed" while its self-check
 * read "dead=geofence_plugin".
 */
export type GeofenceProbeOutcome = "ok" | "absent" | "error";

export async function probeGeofenceState(): Promise<{
  value: GeofenceState | null;
  outcome: GeofenceProbeOutcome;
}> {
  const plugin = (await guard())?.p ?? null;
  if (!plugin) return { value: null, outcome: "absent" };
  try {
    const value = await plugin.getState();
    return { value, outcome: value ? "ok" : "error" };
  } catch {
    return { value: null, outcome: "error" };
  }
}
```

- [ ] **Step 4: Use it at the call site**

In `lib/mileage/native-tracker.ts`, replace line 1085:

```ts
    const geofenceProbe = await probeWithin(
      () => probeGeofenceState(),
      2_000,
    );
    const geofence = geofenceProbe.value;
```

Import `probeGeofenceState` alongside `getGeofenceState` at line 70. In both payloads (about lines 1130 and 1399) add `geofenceProbe: geofenceProbe.outcome` and `geofenceProbeMs: geofenceProbe.ms`, and replace the `probed` expression with:

```ts
          // "We looked" means THIS read returned, not that some other
          // bridge call happened to succeed. The old expression was
          // `geofence != null || dsProbe.outcome !== "timeout"`, which
          // let a healthy device-status read vouch for a geofence read
          // that had timed out, and that is what produced a dead
          // verdict for a plugin that answers.
          probed: geofenceProbe.outcome !== "timeout",
```

- [ ] **Step 5: Teach the self-check the new vocabulary**

In `lib/mileage/self-check.ts`, add `geofenceProbe: string | null;` to the probe type beside `geofenceArmState`, then replace the branch at 179-192:

```ts
  } else if (p.geofenceArmState == null && !p.probed) {
    out.push(check("geofence_plugin", "unknown", "Not probed yet."));
    out.push(check("geofence_armed", "unknown", "Not probed yet."));
  } else if (p.geofenceArmState == null && p.geofenceProbe === "absent") {
    out.push(
      check(
        "geofence_plugin",
        "dead",
        "The plugin is not registered with the bridge. It ships in the binary and is never handed to the WebView.",
      ),
    );
    out.push(
      check("geofence_armed", "unknown", "Cannot arm what does not answer."),
    );
  } else if (p.geofenceArmState == null) {
    out.push(
      check(
        "geofence_plugin",
        "unknown",
        `No arm state, and the read did not complete (${p.geofenceProbe ?? "no outcome"}). A backgrounded WebView times these out routinely, so this is not evidence of a dead plugin.`,
      ),
    );
    out.push(
      check("geofence_armed", "unknown", "Arm state unread."),
    );
  } else {
```

- [ ] **Step 6: Run the test and the suite**

Run: `npx vitest run lib/mileage`
Expected: PASS, including the 36 pre-existing self-check tests.

- [ ] **Step 7: Persist the outcome**

Apply this migration with the Supabase MCP `apply_migration` tool, name `geofence_probe_outcome`:

```sql
alter table public.mileage_device_heartbeats
  add column if not exists geofence_probe text,
  add column if not exists geofence_probe_ms integer;
alter table public.mileage_device_status
  add column if not exists geofence_probe text,
  add column if not exists geofence_probe_ms integer;
comment on column public.mileage_device_status.geofence_probe is
  'Why the geofence read returned what it did: ok, absent, error, timeout. "absent" is the only value that means the plugin is not registered; a null arm state with any other value means we did not manage to look.';
```

Then in `app/api/mileage/heartbeat/route.ts`, beside `car_probe` (about line 187) and `geofence_arm_state` (about line 349), add:

```ts
    geofence_probe: oneOf("geofenceProbe", GEOFENCE_PROBE_VALUES),
    geofence_probe_ms: num("geofenceProbeMs"),
```

with `const GEOFENCE_PROBE_VALUES = ["ok", "absent", "error", "timeout"] as const;` declared beside `CAR_PROBE_VALUES`. Write both columns to both tables, matching exactly how `car_probe` is written to each.

- [ ] **Step 8: Guard the wiring, not just the module**

```ts
// lib/mileage/geofence-probe.test.ts
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
```

- [ ] **Step 9: Run every gate and commit**

Run: `npx vitest run lib/mileage && npx tsc --noEmit && npx eslint lib/mileage app/api/mileage`
Expected: PASS, 0 errors.

```bash
git add lib/mileage/geofence.ts lib/mileage/native-tracker.ts lib/mileage/self-check.ts lib/mileage/self-check.test.ts lib/mileage/geofence-probe.test.ts app/api/mileage/heartbeat/route.ts supabase/migrations
git commit -m "A geofence read that timed out is unknown, not dead"
```

---

### Task 2: Native is told where to post and who it is posting for

**Files:**
- Modify: `android/app/src/main/java/com/taxottic/app/TaxotticGeofencePlugin.java`, `android/app/src/main/java/com/taxottic/app/TaxotticGeofenceStore.java`, `lib/mileage/geofence.ts`
- Test: `lib/mileage/upload-config-wiring.test.ts` (create), `android/app/src/test/java/com/taxottic/app/TaxotticUploadConfigTest.java` (create)

**Interfaces:**
- Produces: plugin method `setUploadConfig({ origin: string; companyId: string })`, persisted in `SharedPreferences` under `taxottic_upload`; Java readers `TaxotticGeofenceStore.getUploadOrigin(Context)` and `getUploadCompanyId(Context)`, both returning `null` when unset.
- Consumes: nothing from Task 1.

The uploader in Task 3 cannot post without these. `syncPlaces` already runs on every resume and is the natural place to push them, because it is the one call that already proves the web layer and the plugin are talking.

- [ ] **Step 1: Write the failing wiring guard**

```ts
// lib/mileage/upload-config-wiring.test.ts
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
});
```

Run: `npx vitest run lib/mileage/upload-config-wiring.test.ts`
Expected: FAIL, no `setUploadConfig` anywhere.

- [ ] **Step 2: Declare and call it from the web layer**

In `lib/mileage/geofence.ts`, add to the plugin interface beside `syncPlaces` (about line 75):

```ts
  setUploadConfig(options: { origin: string; companyId: string }): Promise<void>;
```

and in the function that calls `syncPlaces` (about line 192), before the sync:

```ts
  // The native uploader posts with no JS running, so it needs the two
  // things only the web layer knows: where to post, and which company
  // the fixes belong to. Pushed on the same path as the places
  // themselves so there is exactly one moment where native learns
  // about the world, rather than two that can drift apart.
  try {
    await plugin.setUploadConfig({
      origin: window.location.origin,
      companyId,
    });
  } catch {
    // An older binary has no such method. Places still sync; the
    // uploader simply stays idle, which is the pre-Task-3 behaviour.
  }
```

Thread `companyId` into this function from its caller if it is not already in scope; read the file and follow whatever the caller already passes.

- [ ] **Step 3: Accept it on the Android side**

In `TaxotticGeofencePlugin.java`, beside `syncPlaces`:

```java
    /**
     * Where to POST, and for whom.
     *
     * Stored rather than held in memory because the process that uses
     * it is usually a different one: the OS kills the app, the geofence
     * receiver starts the service cold, and nothing has run any JS.
     */
    @PluginMethod
    public void setUploadConfig(PluginCall call) {
        String origin = call.getString("origin");
        String companyId = call.getString("companyId");
        if (origin == null || origin.isEmpty() || companyId == null || companyId.isEmpty()) {
            call.reject("origin and companyId are both required");
            return;
        }
        TaxotticGeofenceStore.setUploadConfig(getContext(), origin, companyId);
        call.resolve();
    }
```

and in `TaxotticGeofenceStore.java`:

```java
    private static final String PREF_UPLOAD_ORIGIN = "upload_origin";
    private static final String PREF_UPLOAD_COMPANY = "upload_company_id";

    static void setUploadConfig(Context context, String origin, String companyId) {
        prefs(context).edit()
                .putString(PREF_UPLOAD_ORIGIN, origin)
                .putString(PREF_UPLOAD_COMPANY, companyId)
                .apply();
    }

    static String getUploadOrigin(Context context) {
        return prefs(context).getString(PREF_UPLOAD_ORIGIN, null);
    }

    static String getUploadCompanyId(Context context) {
        return prefs(context).getString(PREF_UPLOAD_COMPANY, null);
    }
```

Use whatever the file's existing `prefs(context)` helper is called; read it first and match.

- [ ] **Step 4: Run the guard and the Android unit test**

Run: `npx vitest run lib/mileage && cd android && ./gradlew :app:testDebugUnitTest --tests '*TaxotticUploadConfigTest*' ; cd ..`
Expected: the vitest guard passes. Write `TaxotticUploadConfigTest` to store a config and read it back, following the existing `TaxotticCarBluetoothReceiverTest` for the Robolectric or instrumentation style the project already uses.

- [ ] **Step 5: Commit**

```bash
git add android lib/mileage/geofence.ts lib/mileage/upload-config-wiring.test.ts
git commit -m "Native is told where to post and which company it posts for"
```

---

### Task 3: The Android service posts its own fixes

**Files:**
- Create: `android/app/src/main/java/com/taxottic/app/TaxotticUploader.java`
- Create: `android/app/src/test/java/com/taxottic/app/TaxotticUploaderTest.java`
- Modify: `android/app/src/main/java/com/taxottic/app/TaxotticGeofenceStore.java` (expose buffered fixes as JSON)

**Interfaces:**
- Produces: `TaxotticUploader.upload(Context ctx): Result` where `Result` carries `posted` (int), `remaining` (int) and `reason` (String, one of `ok`, `no_config`, `no_session`, `empty`, `http_<code>`, `io_error`).
- Consumes: `TaxotticGeofenceStore.getUploadOrigin/getUploadCompanyId` from Task 2.

This is the heart of Option B and the only part that moves the 5.9 day p90. It posts to `POST {origin}/api/mileage/ingest` with `{ companyId, points, backlog: true }`, authenticated by the session cookie read from `android.webkit.CookieManager`, exactly as `docs/design/upload-latency.md` anticipated. `backlog: true` is not optional: `app/api/mileage/ingest/route.ts:44` documents that stored-and-forwarded batches must not have their clock skew corrected, and every fix this uploader sends is by construction stored and forwarded.

- [ ] **Step 1: Write the failing test**

```java
// android/app/src/test/java/com/taxottic/app/TaxotticUploaderTest.java
public class TaxotticUploaderTest {
    @Test
    public void refusesWithoutConfig() {
        Context ctx = ApplicationProvider.getApplicationContext();
        TaxotticUploader.Result r = TaxotticUploader.upload(ctx);
        assertEquals("no_config", r.reason);
        assertEquals(0, r.posted);
    }

    @Test
    public void refusesWithoutASessionCookie() {
        Context ctx = ApplicationProvider.getApplicationContext();
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticUploader.Result r = TaxotticUploader.upload(ctx);
        assertEquals("no_session", r.reason);
    }

    @Test
    public void doesNothingWithAnEmptyBuffer() {
        Context ctx = ApplicationProvider.getApplicationContext();
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        // The cookie and the transport are both seams, so the test can
        // supply them without a network or a WebView.
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, () -> "sb-access-token=abc", (url, cookie, body) -> 200);
        assertEquals("empty", r.reason);
    }

    @Test
    public void consumesOnlyWhatTheServerAccepted() {
        Context ctx = ApplicationProvider.getApplicationContext();
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticGeofenceStore.appendFix(ctx, fixAt(1_700_000_000_000L), "p1", "test");
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, () -> "sb-access-token=abc", (url, cookie, body) -> 500);
        assertEquals("http_500", r.reason);
        assertEquals("a rejected batch must stay on the phone",
                1, TaxotticGeofenceStore.countBufferedFixes(ctx));
    }
}
```

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests '*TaxotticUploaderTest*'`
Expected: FAIL, the class does not exist.

- [ ] **Step 2: Implement the uploader**

```java
package com.taxottic.app;

import android.content.Context;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.List;

/**
 * Posts buffered fixes with no JS running.
 *
 * The WebView's flush tick can only drain while the app is alive, and
 * this phone's app is killed nightly: measured over 21 days, the median
 * fix reached the server 24 hours after capture and p90 was 5.9 days.
 * Everything here therefore has to work in a process that started cold
 * from a geofence receiver.
 */
final class TaxotticUploader {

    /** Reads the session cookie. A seam so the test needs no WebView. */
    interface CookieSource {
        String cookieFor(String origin);
    }

    /** Performs the POST and returns the status code. A seam for tests. */
    interface Transport {
        int post(String url, String cookie, String body) throws IOException;
    }

    static final class Result {
        final int posted;
        final int remaining;
        final String reason;

        Result(int posted, int remaining, String reason) {
            this.posted = posted;
            this.remaining = remaining;
            this.reason = reason;
        }
    }

    private static final int MAX_BATCH = 500;

    static Result upload(Context ctx) {
        return upload(ctx, TaxotticUploader::systemCookie, TaxotticUploader::httpPost);
    }

    static Result upload(Context ctx, CookieSource cookies, Transport transport) {
        String origin = TaxotticGeofenceStore.getUploadOrigin(ctx);
        String companyId = TaxotticGeofenceStore.getUploadCompanyId(ctx);
        if (origin == null || origin.isEmpty() || companyId == null || companyId.isEmpty()) {
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "no_config");
        }

        String cookie = cookies.cookieFor(origin);
        // Supabase names every session cookie with an sb- prefix. A
        // cookie string without one is a visitor, not a driver, and
        // posting would just collect 401s.
        if (cookie == null || !cookie.contains("sb-")) {
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "no_session");
        }

        List<JSONObject> fixes = TaxotticGeofenceStore.readBufferedFixes(ctx, MAX_BATCH);
        if (fixes.isEmpty()) return new Result(0, 0, "empty");

        String body;
        try {
            JSONArray points = new JSONArray();
            for (JSONObject fix : fixes) {
                JSONObject p = new JSONObject();
                p.put("lat", fix.getDouble("lat"));
                p.put("lng", fix.getDouble("lng"));
                p.put("ts", fix.getLong("ts"));
                points.put(p);
            }
            JSONObject payload = new JSONObject();
            payload.put("companyId", companyId);
            payload.put("points", points);
            // Stored and forwarded by construction. The ingest route
            // documents that these must not have their clock skew
            // corrected, because their lag is the design, not a device
            // whose clock is wrong.
            payload.put("backlog", true);
            body = payload.toString();
        } catch (Exception e) {
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "io_error");
        }

        int status;
        try {
            status = transport.post(origin + "/api/mileage/ingest", cookie, body);
        } catch (IOException e) {
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "io_error");
        }

        if (status < 200 || status >= 300) {
            return new Result(0, TaxotticGeofenceStore.countBufferedFixes(ctx), "http_" + status);
        }

        TaxotticGeofenceStore.consumeBuffer(ctx, fixes.size());
        return new Result(fixes.size(), TaxotticGeofenceStore.countBufferedFixes(ctx), "ok");
    }

    private static String systemCookie(String origin) {
        try {
            return CookieManager.getInstance().getCookie(origin);
        } catch (Throwable t) {
            return null;
        }
    }

    private static int httpPost(String url, String cookie, String body) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestMethod("POST");
            c.setConnectTimeout(15_000);
            c.setReadTimeout(30_000);
            c.setDoOutput(true);
            c.setRequestProperty("Content-Type", "application/json");
            c.setRequestProperty("Cookie", cookie);
            try (OutputStream out = c.getOutputStream()) {
                out.write(body.getBytes("UTF-8"));
            }
            return c.getResponseCode();
        } finally {
            c.disconnect();
        }
    }

    private TaxotticUploader() {}
}
```

`readBufferedFixes(Context, int)` does not exist yet: add it to `TaxotticGeofenceStore` beside `countBufferedFixes` (line 381), returning the oldest N buffered fixes as `JSONObject`s carrying `lat`, `lng` and `ts`. Read `appendFix` (line 319) for the stored shape and convert on the way out so the wire format matches `GpsPoint` as `app/api/mileage/ingest/route.ts:49` validates it.

Two rules that are not negotiable, both learned the hard way in this repo:

- **Consume only after a 2xx.** `lib/mileage/drain-coverage.ts` exists because two drains posted the same batch. A fix that was posted but not consumed is a duplicate; a fix consumed but never posted is a lost drive. The server dedupes on `(driver, captured_at, lat, lng)`, so the duplicate is the survivable error and the loss is not.
- **Never run this on the main thread.** It is called from a service; use the service's existing executor, and if there is none, a single-thread `ExecutorService` owned by the uploader.

Point shape must match `GpsPoint` as `app/api/mileage/ingest/route.ts:49` validates it: `lat` and `lng` as numbers and `ts` as a number of milliseconds. Read `TaxotticGeofenceStore.appendFix` (line 319) for how a fix is stored and convert on the way out.

- [ ] **Step 3: Run the tests**

Run: `cd android && ./gradlew :app:testDebugUnitTest --tests '*TaxotticUploaderTest*'`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add android
git commit -m "The Android capture service can post its own fixes"
```

---

### Task 4: The uploader is actually called

**Files:**
- Modify: `android/app/src/main/java/com/taxottic/app/TaxotticResurrectionService.java`
- Test: `android/app/src/test/java/com/taxottic/app/TaxotticUploaderCallSiteTest.java` (create)

**Interfaces:**
- Consumes: `TaxotticUploader.upload` from Task 3.

A built, bridged, never-called function is this project's signature failure: `TaxotticDeviceStatusPlugin` was dead for weeks, four iOS functions needed [#602](https://github.com/TechnoOptics/taxottic/pull/602) to give them a caller, and the buffer bug Option A fixed was "a missing call site, not an OS constraint". This task is the call site, and it gets its own reviewer gate for that reason.

- [ ] **Step 1: Write the failing call-site guard**

```java
// Reads the service source and asserts the call exists. A behavioural
// test would need a real service lifecycle; this catches the failure
// that actually happens, which is nobody calling it at all.
public class TaxotticUploaderCallSiteTest {
    @Test
    public void theServiceCallsTheUploader() throws Exception {
        String src = readSource("TaxotticResurrectionService.java");
        assertTrue("the service never calls TaxotticUploader", src.contains("TaxotticUploader.upload"));
    }

    @Test
    public void itUploadsWhenCaptureEnds() throws Exception {
        String src = readSource("TaxotticResurrectionService.java");
        int ends = src.indexOf("CAPTURE_ENDED");
        assertTrue("no capture-ended path to hang the upload on", ends > 0);
    }
}
```

Match the constant to whatever the service actually uses to mark the end of a capture; read it first.

- [ ] **Step 2: Call it**

Upload at two moments and no others: when a capture ends, and when the service starts holding a backlog, which is the cold start after a kill and the case that owns the 5.9 day tail. Do not add a timer; the service already has a lifecycle and a periodic upload would hold the radio awake for nothing.

```java
    /**
     * Never on the caller's thread: this runs inside onStartCommand and
     * inside the capture-ended path, both of which are the main thread,
     * and a 30 second read timeout there is an ANR.
     */
    private void uploadInBackground(String trigger) {
        UPLOAD_EXECUTOR.execute(() -> {
            TaxotticUploader.Result r = TaxotticUploader.upload(getApplicationContext());
            TaxotticGeofenceStore.recordUpload(
                    getApplicationContext(), trigger, r.posted, r.reason);
        });
    }

    private static final java.util.concurrent.ExecutorService UPLOAD_EXECUTOR =
            java.util.concurrent.Executors.newSingleThreadExecutor();
```

Call `uploadInBackground("capture_ended")` where the service marks a capture finished, and in `onStartCommand`, after the foreground notification is posted:

```java
        if (TaxotticGeofenceStore.countBufferedFixes(this) > 0) {
            uploadInBackground("cold_start_backlog");
        }
```

Add `recordUpload(Context, String trigger, int points, String reason)` to `TaxotticGeofenceStore`, writing into the same preference the existing native drain fields are read from so the next heartbeat carries it: `native_drain_trigger` takes the trigger string, `native_drain_points` the count. Read how `geofence_capture` is stored and reported and follow it exactly, so the value reaches `mileage_device_status` by the path that already works.

- [ ] **Step 3: Run the tests and commit**

Run: `cd android && ./gradlew :app:testDebugUnitTest`
Expected: PASS.

```bash
git add android
git commit -m "The service uploads when a capture ends and when it starts holding a backlog"
```

---

### Task 5: Android hardening from the 2026-09-14 audit

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml:4`, `android/app/src/main/java/com/taxottic/app/TaxotticResurrectionService.java:390`
- Test: `lib/mileage/android-manifest.test.ts` (create)

- [ ] **Step 1: Write the failing guard**

```ts
// lib/mileage/android-manifest.test.ts
import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

describe("the Android manifest and channels match the audit", () => {
  const manifest = readFileSync("android/app/src/main/AndroidManifest.xml", "utf8");

  it("does not back up the app's data to the cloud", () => {
    // A restored backup carries a stale device id and a dead session
    // into a phone that then reports as the original device.
    expect(manifest).toMatch(/android:allowBackup="false"/);
  });

  it("the capture channel is not the quietest one available", () => {
    const service = readFileSync(
      "android/app/src/main/java/com/taxottic/app/TaxotticResurrectionService.java",
      "utf8",
    );
    expect(service).toMatch(/IMPORTANCE_DEFAULT/);
    expect(service).not.toMatch(/IMPORTANCE_LOW/);
  });
});
```

- [ ] **Step 2: Make both changes**

Set `android:allowBackup="false"` in the manifest, and raise the capture channel from `IMPORTANCE_LOW` to `IMPORTANCE_DEFAULT`. The channel's importance is what several OEM task killers read when deciding what to cull, and this phone's last exit was `low_memory`.

Note in the commit body that an existing install keeps the channel importance it was created with, so this only reaches phones that reinstall, and that the audit's finding stands for new installs.

- [ ] **Step 3: Run and commit**

Run: `npx vitest run lib/mileage/android-manifest.test.ts`
Expected: PASS.

```bash
git add android lib/mileage/android-manifest.test.ts
git commit -m "No cloud backup, and the capture channel is not the quietest one"
```

---

### Task 6: The iOS back gesture

**Files:**
- Modify: `ios/App/App/AppDelegate.swift` or the `CAPBridgeViewController` subclass, whichever owns the web view; find it with `grep -rn "CAPBridgeViewController\|WKWebView" ios/App/App`
- Test: `lib/mileage/ios-webview-config.test.ts` (create)

- [ ] **Step 1: Write the failing guard**

```ts
import { readFileSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";

describe("the iOS web view allows the edge swipe", () => {
  it("sets allowsBackForwardNavigationGestures", () => {
    const dir = "ios/App/App";
    const swift = readdirSync(dir)
      .filter((f) => f.endsWith(".swift"))
      .map((f) => readFileSync(`${dir}/${f}`, "utf8"))
      .join("\n");
    expect(
      swift,
      "an edge swipe does nothing on iOS without this",
    ).toMatch(/allowsBackForwardNavigationGestures\s*=\s*true/);
  });
});
```

- [ ] **Step 2: Set it, run, commit**

Set `webView?.allowsBackForwardNavigationGestures = true` where the bridge finishes loading. Remember that a new `.swift` file must be registered in `project.pbxproj` or it compiles to nothing; prefer editing an existing file for that reason.

```bash
git add ios lib/mileage/ios-webview-config.test.ts
git commit -m "An edge swipe goes back on iOS"
```

---

### Task 7: Sign-in links open the app, not Safari

**Files:**
- Create: `app/.well-known/apple-app-site-association/route.ts`
- Modify: `ios/App/App/App.entitlements`, `middleware.ts` (the `PUBLIC_PATHS` list)
- Test: `e2e/well-known.spec.ts` (create), `lib/seo/public-paths.test.ts` (extend if it exists)

An account-less route that is not in `PUBLIC_PATHS` is 307'd to `/login`, which for this file would mean Apple fetching a redirect and deep links silently never working. That has already happened twice in this repo.

- [ ] **Step 1: Write the failing test**

```ts
// e2e/well-known.spec.ts
import { test, expect } from "@playwright/test";

test("the AASA file is served to Apple as JSON, with no redirect", async ({ request }) => {
  const res = await request.get("/.well-known/apple-app-site-association", {
    maxRedirects: 0,
  });
  expect(res.status(), "a redirect here means deep links never work").toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  const body = await res.json();
  expect(body.applinks.details[0].appIDs[0]).toMatch(/^[A-Z0-9]{10}\.com\.taxottic\.app$/);
});
```

- [ ] **Step 2: Serve it**

Create the route returning `application/json` with no extension, the `applinks` block naming `${APPLE_TEAM_ID}.com.taxottic.app`, and paths limited to the ones that should open the app: `/login*`, `/app/*`, `/get*`.

The team id is deliberately NOT hardcoded. It is not in the repo: `ios/App/App.xcodeproj/project.pbxproj` has no `DEVELOPMENT_TEAM`, and the release workflow injects it from the `IOS_TEAM_ID` GitHub secret (`.github/workflows/ios-release.yml:48`). So read `process.env.APPLE_TEAM_ID` and, when it is unset, return a 500 rather than a file with a placeholder in it:

```ts
  const team = process.env.APPLE_TEAM_ID;
  if (!team) {
    // A wrong or placeholder team id is worse than no file at all:
    // Apple caches this aggressively, so a bad one poisons deep links
    // for as long as the cache holds. A 500 fails closed and visibly.
    return new NextResponse("APPLE_TEAM_ID is not set", { status: 500 });
  }
```

The owner sets `APPLE_TEAM_ID` in Vercel to the same value as the `IOS_TEAM_ID` secret. Say so in the PR body under owner-only items, because deep links stay dead until they do.

Add the path to `PUBLIC_PATHS` in `middleware.ts`, and add `com.apple.developer.associated-domains` with `applinks:taxottic.com` to the entitlements.

- [ ] **Step 3: Run and commit**

Run: `npx playwright test e2e/well-known.spec.ts`
Expected: PASS.

```bash
git add app/.well-known ios middleware.ts e2e/well-known.spec.ts
git commit -m "Serve the associated-domains file so a sign-in link opens the app"
```

---

### Task 8: The Android picker theme

**Files:**
- Modify: `android/app/src/main/res/values/styles.xml` and the dark variant if one exists

The audit found the native `<select>` popup rendering against the wrong background, which `MainActivity`'s comment already explains: the launch theme used to set `android:background` and the value leaked into every view built from the Activity context, including the ListView the Chromium picker builds. Confirm the current rendering on an emulator in both themes before changing anything, and if it renders correctly now, record that and skip the change rather than editing blind.

- [ ] **Step 1: Verify, then fix or record**

Open a calculator page and a form with a `<select>` in the emulator, light and dark, screenshot both, and either fix the theme and re-screenshot or write "no change needed, verified at <date>" into the task report with the screenshots attached.

- [ ] **Step 2: Commit only if something changed**

```bash
git commit -m "The native picker reads in both themes"
```

---

### Task 9: Bump, gate, screenshot, PR

**Files:**
- Modify: `public/sw.js`

- [ ] **Step 1: Bump the worker**

Survey first: `git show origin/main:public/sw.js | grep 'const CACHE_VERSION'` and the same for every open PR head. Take the next free number (v210 at the time of writing) and write an entry in the v208 style naming the client-visible change: the heartbeat payload gained two fields and the self-check's verdicts changed.

- [ ] **Step 2: Every gate**

Run, with a warm dev server because a cold Next dev server serves a loading shell on a route's first hit:

```bash
npx tsc --noEmit
npx eslint . --ignore-pattern 'playwright/.cache/**'
npx vitest run
npx playwright test -c playwright-ct.config.ts
npx playwright test --workers=1
cd android && ./gradlew :app:testDebugUnitTest && ./gradlew :app:assembleDebug ; cd ..
```

Expected: tsc clean, eslint 0 errors, every suite green, the Android build compiling. If the iOS toolchain is available, `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -destination 'generic/platform=iOS Simulator' build`; if it is not, say so in the PR rather than implying it was checked.

- [ ] **Step 3: The PR**

Body at `.superpowers/pr5-body.md` (gitignored): the measured table that justifies Option B for Android and refuses it for iOS, the false-dead verdict and how many heartbeats disproved it, each task, the gates with numbers, and an explicit list of what cannot be verified without a store build. Close with the one line saying the "Generated with Claude Code" footer is omitted because the repo's writing rules take precedence.

```bash
gh pr create --base main --head feat/native-layer --title "The native layer: Android uploads its own drives, and a timed-out probe stops reading as a dead plugin (SW v210)"
```

The owner merges, and then cuts an Android build. Nothing in tasks 2 to 6 reaches a phone until they do.

---

## What this plan does not do

- **It does not fix capture gaps.** Every fix here is about points that were captured and are waiting. A point never captured is `docs/design/self-healing-capture.md`'s subject, and the Android phone shows days with no points at all (2026-09-19 to 21) that this work would not have changed. Whether those days were quiet or dark cannot be told from telemetry alone, and the honest next step is to ask the owner whether they drove.
- **It does not touch iOS upload.** p90 is 16 minutes there. The design doc's warning that Option B "on iOS does not deliver what it promises" stands, and the measurement says it is not needed.
- **It does not change the finalize window.** `docs/design/upload-latency.md` is explicit that making it lag-aware means re-deriving thresholds that are only trusted empirically. A backlog that now arrives within minutes rather than days will exercise the clock-skew shift for the first time, so watch `mileage_render_refusals` and duplicate counts after the build ships.
- **It does not explain the 1,285 unconsumed raw points** for the Android driver, 827 of them moving, on 2026-09-17. Points that arrived and never became a drive are a separate defect worth its own investigation.
