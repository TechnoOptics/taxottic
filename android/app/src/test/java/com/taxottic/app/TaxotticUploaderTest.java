package com.taxottic.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.content.Context;
import android.location.Location;

import androidx.test.core.app.ApplicationProvider;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

import org.junit.Before;
import org.junit.Test;

/**
 * The uploader's refusals and its one consume rule.
 *
 * HOW THIS RUNS. Robolectric supplies a real Context and a working
 * org.json on the JVM, so `./gradlew :app:testDebugUnitTest` exercises
 * the uploader's logic without a phone. The dependencies and the
 * testOptions block live in android/app/build.gradle, and CI runs that
 * Gradle task in the "android compiles" job alongside
 * compileDebugJavaWithJavac, which on its own never compiles this
 * source set.
 *
 * The properties that survive without any Java running at all are
 * asserted separately from the node suite by
 * lib/mileage/native-uploader.test.ts, which reads this package's
 * source. Two layers on purpose: the node guard catches a wrong
 * implementation in a PR even if the Gradle job is skipped, and this
 * file catches one that only misbehaves when actually executed.
 */
@RunWith(RobolectricTestRunner.class)
public class TaxotticUploaderTest {

    private Context ctx;

    @Before
    public void setUp() {
        ctx = ApplicationProvider.getApplicationContext();
        TaxotticGeofenceStore.consumeBuffer(ctx, Integer.MAX_VALUE);
        TaxotticGeofenceStore.setUploadConfig(ctx, "", "");
    }

    @Test
    public void refusesWithoutConfig() {
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> "sb-access-token=abc", SINK, (url, cookie, body) -> ok(200));
        assertEquals("no_config", r.reason);
        assertEquals(0, r.posted);
    }

    /**
     * window.location.origin is capacitor://localhost the moment the
     * shell stops loading a remote URL. Posting to that fails somewhere
     * inside HttpURLConnection on a background thread, which reads as
     * "uploads just stopped".
     */
    @Test
    public void refusesAnOriginThatIsNotHttp() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "capacitor://localhost", "co_1");
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> "sb-access-token=abc", SINK, (url, cookie, body) -> ok(200));
        assertEquals("bad_origin", r.reason);
        assertEquals(0, r.posted);
    }

    @Test
    public void refusesWithoutASessionCookie() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> null, SINK, (url, cookie, body) -> ok(200));
        assertEquals("no_session", r.reason);
    }

    @Test
    public void doesNothingWithAnEmptyBuffer() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        // The cookie and the transport are both seams, so the test can
        // supply them without a network or a WebView.
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> "sb-access-token=abc", SINK, (url, cookie, body) -> ok(200));
        assertEquals("empty", r.reason);
    }

    /**
     * The rule the whole file exists for. A rejected batch stays on the
     * phone: the buffer is the only copy of it.
     */
    @Test
    public void keepsEverythingWhenTheServerRejectsTheBatch() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticGeofenceStore.appendFix(ctx, fixAt(1_700_000_000_000L), "p1", "test");
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> "sb-access-token=abc", SINK, (url, cookie, body) -> ok(500));
        assertEquals("http_500", r.reason);
        assertEquals("a rejected batch must stay on the phone",
                1, TaxotticGeofenceStore.countBufferedFixes(ctx));
    }

    @Test
    public void keepsEverythingWhenThePostThrows() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticGeofenceStore.appendFix(ctx, fixAt(1_700_000_000_000L), "p1", "test");
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> "sb-access-token=abc", SINK, (url, cookie, body) -> {
                    throw new java.io.IOException("radio is off");
                });
        assertEquals("io_error", r.reason);
        assertEquals(1, TaxotticGeofenceStore.countBufferedFixes(ctx));
    }

    @Test
    public void consumesOnlyAfterA2xx() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticGeofenceStore.appendFix(ctx, fixAt(1_700_000_000_000L), "p1", "test");
        TaxotticGeofenceStore.appendFix(ctx, fixAt(1_700_000_001_000L), "p1", "test");
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> "sb-access-token=abc", SINK, (url, cookie, body) -> ok(200));
        assertEquals("ok", r.reason);
        assertEquals(2, r.posted);
        assertEquals(0, TaxotticGeofenceStore.countBufferedFixes(ctx));
    }

    /**
     * The wire shape the ingest route validates. isFinitePoint drops a
     * point of any other shape without a word, so posting the stored
     * names would look like a clean 200 that ingested nothing.
     */
    @Test
    public void postsLatLngTsInMilliseconds() throws Exception {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticGeofenceStore.appendFix(ctx, fixAt(1_700_000_000_000L), "p1", "test");
        final String[] sent = new String[1];
        final String[] posted = new String[1];
        TaxotticUploader.upload(ctx, origin -> "sb-access-token=abc", SINK, (url, cookie, body) -> {
            posted[0] = url;
            sent[0] = body;
            return ok(200);
        });
        assertEquals("https://taxottic.com/api/mileage/ingest", posted[0]);
        org.json.JSONObject payload = new org.json.JSONObject(sent[0]);
        assertEquals("co_1", payload.getString("companyId"));
        assertEquals(true, payload.getBoolean("backlog"));
        org.json.JSONObject point = payload.getJSONArray("points").getJSONObject(0);
        assertEquals(41.5, point.getDouble("lat"), 0.0001);
        assertEquals(-93.6, point.getDouble("lng"), 0.0001);
        assertEquals(1_700_000_000_000L, point.getLong("ts"));
    }

    /**
     * The interleaving that loses a drive, executed.
     *
     * Two consumers drain the one buffer file from the one process: this
     * uploader on its executor, and the JS drain in
     * lib/mileage/geofence.ts, which the driver triggers just by opening
     * the app (drainNativeBuffers on resume, which also drives the
     * service to stopWithState, which is upload trigger one). Nothing in
     * AndroidManifest.xml declares android:process, so they share static
     * state and they genuinely interleave.
     *
     * The reviewer's sequence needs no appends and no timing luck:
     *
     *   900 buffered. JS reads all 900 and posts its first 800 (its cap
     *   is UPLOAD_BATCH_MAX). Native reads 500, posts, consumes 500.
     *   JS then consumes 800 and takes the whole file, including lines
     *   801 to 900, which NOBODY posted.
     *
     * With the generation token, native's consume moves the buffer on,
     * JS's consume is refused, and the unposted tail survives to be
     * re-read. The duplicate that costs is absorbed by ingest, which
     * dedupes on (driver, company, captured_at).
     *
     * Deliberately uses 900 fixes and a transport that accepts the first
     * batch and rejects the next, so the assertion holds whether or not
     * the uploader loops over several batches in one run.
     */
    @Test
    public void aConcurrentJsDrainCannotDropFixesNobodyPosted() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        for (int i = 0; i < 900; i++) {
            TaxotticGeofenceStore.appendFix(ctx, fixAt(BASE_TS + i * 1000L), "p1", "test");
        }

        // The JS drain reads the whole buffer and posts its first 800.
        TaxotticGeofenceStore.BufferRead jsRead =
                TaxotticGeofenceStore.readBufferedFixes(ctx, 5000);
        assertEquals(900, jsRead.fixes.size());

        // The native uploader runs while that POST is in flight. First
        // batch accepted, any further batch refused.
        final int[] calls = new int[1];
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> "sb-access-token=abc", SINK,
                (url, cookie, body) -> ok(++calls[0] == 1 ? 200 : 500));
        assertEquals(500, r.posted);
        assertEquals(400, TaxotticGeofenceStore.countBufferedFixes(ctx));

        // Now the JS drain's consume lands, carrying the token from a
        // buffer that no longer exists. It must be refused outright.
        boolean consumed = TaxotticGeofenceStore.consumeBuffer(ctx, 800, jsRead.generation);
        assertFalse("a consume against a buffer that moved must be refused", consumed);
        assertEquals("the tail nobody posted must survive",
                400, TaxotticGeofenceStore.countBufferedFixes(ctx));

        // And it is the RIGHT 400: fix 501 onwards, still oldest first.
        TaxotticGeofenceStore.BufferRead after =
                TaxotticGeofenceStore.readBufferedFixes(ctx, 1);
        assertEquals(BASE_TS + 500_000L, after.fixes.get(0).optLong("ts"));
    }

    @Test
    public void aConsumeWithACurrentTokenStillWorks() {
        // The guard must refuse a stale token without refusing everything,
        // or the buffer never drains at all.
        TaxotticGeofenceStore.appendFix(ctx, fixAt(BASE_TS), "p1", "test");
        TaxotticGeofenceStore.BufferRead read = TaxotticGeofenceStore.readBufferedFixes(ctx, 10);
        assertTrue(TaxotticGeofenceStore.consumeBuffer(ctx, 1, read.generation));
        assertEquals(0, TaxotticGeofenceStore.countBufferedFixes(ctx));
    }

    @Test
    public void anAppendAlsoInvalidatesAnOutstandingToken() {
        // The capture service appends at 1 Hz while an upload is in
        // flight. A token that survived an append would let a consume
        // drop a line the reader never saw.
        TaxotticGeofenceStore.appendFix(ctx, fixAt(BASE_TS), "p1", "test");
        TaxotticGeofenceStore.BufferRead read = TaxotticGeofenceStore.readBufferedFixes(ctx, 10);
        TaxotticGeofenceStore.appendFix(ctx, fixAt(BASE_TS + 1000L), "p1", "test");
        assertFalse(TaxotticGeofenceStore.consumeBuffer(ctx, 1, read.generation));
        assertEquals(2, TaxotticGeofenceStore.countBufferedFixes(ctx));
    }

    /**
     * The session cookie the server rotated must be written back.
     *
     * lib/supabase/middleware.ts runs getUser() before its /api/ early
     * return, so a POST carrying an expired access token makes the
     * server refresh and rotate. Rotation is on here: 171 of 174 refresh
     * tokens over one week are revoked. HttpURLConnection has no
     * CookieHandler, so a dropped Set-Cookie leaves the WebView holding
     * a revoked token and the driver is signed out at the next app open.
     * An uploader that does that is worse than no uploader.
     */
    @Test
    public void writesRotatedCookiesBackIntoTheJar() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticGeofenceStore.appendFix(ctx, fixAt(BASE_TS), "p1", "test");
        final java.util.List<String> stored = new java.util.ArrayList<>();
        final String[] storedOrigin = new String[1];
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx,
                origin -> "sb-access-token=old",
                (origin, setCookies) -> {
                    storedOrigin[0] = origin;
                    stored.addAll(setCookies);
                },
                (url, cookie, body) -> new TaxotticUploader.Response(
                        200,
                        java.util.Arrays.asList(
                                "sb-access-token=new; Path=/; HttpOnly",
                                "sb-refresh-token=rotated; Path=/; HttpOnly")));
        assertEquals("ok", r.reason);
        assertEquals("https://taxottic.com", storedOrigin[0]);
        assertEquals(2, stored.size());
        assertTrue(stored.get(0).startsWith("sb-access-token=new"));
        assertTrue(stored.get(1).startsWith("sb-refresh-token=rotated"));
    }

    @Test
    public void writesTheJarBeforeConsumingTheBuffer() {
        // A rotated session is more expensive to lose than a duplicate
        // upload, so the write back must not sit behind the consume.
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticGeofenceStore.appendFix(ctx, fixAt(BASE_TS), "p1", "test");
        final int[] bufferedWhenStored = new int[] { -1 };
        TaxotticUploader.upload(
                ctx,
                origin -> "sb-access-token=old",
                (origin, setCookies) ->
                        bufferedWhenStored[0] = TaxotticGeofenceStore.countBufferedFixes(ctx),
                (url, cookie, body) -> ok(200));
        assertEquals("the cookie was written after the buffer was consumed",
                1, bufferedWhenStored[0]);
    }

    /**
     * A WebView provider that will not load is not a signed-out driver.
     * One word for both is how a dead feature reads as a user problem.
     */
    @Test
    public void namesAMissingCookieJarSeparatelyFromAMissingSession() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticGeofenceStore.appendFix(ctx, fixAt(BASE_TS), "p1", "test");
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx,
                origin -> {
                    throw new TaxotticUploader.CookieJarUnavailable(
                            new RuntimeException("webview provider missing"));
                },
                SINK,
                (url, cookie, body) -> ok(200));
        assertEquals("no_cookie_jar", r.reason);
        assertEquals("a refusal must never consume", 1,
                TaxotticGeofenceStore.countBufferedFixes(ctx));
    }

    /**
     * A redirect in front of the route, followed as a GET, returns 200
     * from an HTML page. Consuming on that would delete the buffer with
     * nothing ingested.
     */
    @Test
    public void treatsARedirectAsAFailureAndKeepsTheBuffer() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticGeofenceStore.appendFix(ctx, fixAt(BASE_TS), "p1", "test");
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> "sb-access-token=abc", SINK, (url, cookie, body) -> ok(301));
        assertEquals("http_301", r.reason);
        assertEquals(1, TaxotticGeofenceStore.countBufferedFixes(ctx));
    }

    /**
     * One trigger drains the whole backlog, not one batch of it.
     *
     * The observed buffer on the reporting phone was 1512 fixes, and one
     * 20 minute drive at 1 Hz is 1200. At 500 per trigger those needed
     * three separate geofence exits to clear, while remaining was
     * recorded and never acted on.
     */
    @Test
    public void drainsAMultiBatchBacklogInOneRun() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        for (int i = 0; i < 1200; i++) {
            TaxotticGeofenceStore.appendFix(ctx, fixAt(BASE_TS + i * 1000L), "p1", "test");
        }
        final int[] calls = new int[1];
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> "sb-access-token=abc", SINK, (url, cookie, body) -> {
                    calls[0]++;
                    return ok(200);
                });
        assertEquals("ok", r.reason);
        assertEquals(1200, r.posted);
        assertEquals(0, r.remaining);
        assertEquals("500 + 500 + 200", 3, calls[0]);
        assertEquals(0, TaxotticGeofenceStore.countBufferedFixes(ctx));
    }

    @Test
    public void stopsLoopingAsSoonAsABatchIsRefused() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        for (int i = 0; i < 1200; i++) {
            TaxotticGeofenceStore.appendFix(ctx, fixAt(BASE_TS + i * 1000L), "p1", "test");
        }
        final int[] calls = new int[1];
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> "sb-access-token=abc", SINK,
                (url, cookie, body) -> ok(++calls[0] == 1 ? 200 : 503));
        assertEquals("http_503", r.reason);
        assertEquals("the accepted batch still counts", 500, r.posted);
        assertEquals("nothing past the refusal is retried in this run", 2, calls[0]);
        assertEquals(700, TaxotticGeofenceStore.countBufferedFixes(ctx));
    }

    /**
     * sessionEnded tail-closes the trip instead of stranding it open
     * until the finalize cron. The JS geofence drain has always sent it.
     * It belongs on the batch carrying the tail and nowhere else: on an
     * intermediate batch it would close a drive the next batch then
     * continues, splitting one trip into fragments.
     */
    @Test
    public void sendsSessionEndedOnlyOnTheLastBatchOfAFinishedCapture() throws Exception {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        for (int i = 0; i < 700; i++) {
            TaxotticGeofenceStore.appendFix(ctx, fixAt(BASE_TS + i * 1000L), "p1", "test");
        }
        final java.util.List<String> bodies = new java.util.ArrayList<>();
        TaxotticUploader.upload(
                ctx, "capture_ended", origin -> "sb-access-token=abc", SINK,
                (url, cookie, body) -> {
                    bodies.add(body);
                    return ok(200);
                });
        assertEquals(2, bodies.size());
        assertFalse("the first 500 are not the tail",
                new org.json.JSONObject(bodies.get(0)).optBoolean("sessionEnded", false));
        assertTrue("the last 200 are the tail of the capture",
                new org.json.JSONObject(bodies.get(1)).optBoolean("sessionEnded", false));
    }

    @Test
    public void doesNotClaimASessionEndedOnAColdStartBacklog() throws Exception {
        // A cold start is holding an older session's fixes. Its newest
        // point is not the end of anything the driver just did, and
        // claiming otherwise closes a trip that may still be running.
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticGeofenceStore.appendFix(ctx, fixAt(BASE_TS), "p1", "test");
        final String[] body = new String[1];
        TaxotticUploader.upload(
                ctx, "cold_start_backlog", origin -> "sb-access-token=abc", SINK,
                (url, cookie, sent) -> {
                    body[0] = sent;
                    return ok(200);
                });
        assertFalse(new org.json.JSONObject(body[0]).has("sessionEnded"));
    }

    /** A transport that answers with a status and no rotated cookies. */
    private static TaxotticUploader.Response ok(int status) {
        return new TaxotticUploader.Response(status, null);
    }

    /** A sink for the tests that are not about cookie rotation. */
    private static final TaxotticUploader.CookieSink SINK = (origin, setCookies) -> {};

    private static final long BASE_TS = 1_700_000_000_000L;

    private static Location fixAt(long timeMs) {
        Location l = new Location("test");
        l.setLatitude(41.5);
        l.setLongitude(-93.6);
        l.setAccuracy(8f);
        l.setTime(timeMs);
        return l;
    }
}
