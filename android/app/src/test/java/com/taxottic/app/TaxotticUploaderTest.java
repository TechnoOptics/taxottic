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
                ctx, origin -> "sb-access-token=abc", (url, cookie, body) -> 200);
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
                ctx, origin -> "sb-access-token=abc", (url, cookie, body) -> 200);
        assertEquals("bad_origin", r.reason);
        assertEquals(0, r.posted);
    }

    @Test
    public void refusesWithoutASessionCookie() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> null, (url, cookie, body) -> 200);
        assertEquals("no_session", r.reason);
    }

    @Test
    public void doesNothingWithAnEmptyBuffer() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        // The cookie and the transport are both seams, so the test can
        // supply them without a network or a WebView.
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> "sb-access-token=abc", (url, cookie, body) -> 200);
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
                ctx, origin -> "sb-access-token=abc", (url, cookie, body) -> 500);
        assertEquals("http_500", r.reason);
        assertEquals("a rejected batch must stay on the phone",
                1, TaxotticGeofenceStore.countBufferedFixes(ctx));
    }

    @Test
    public void keepsEverythingWhenThePostThrows() {
        TaxotticGeofenceStore.setUploadConfig(ctx, "https://taxottic.com", "co_1");
        TaxotticGeofenceStore.appendFix(ctx, fixAt(1_700_000_000_000L), "p1", "test");
        TaxotticUploader.Result r = TaxotticUploader.upload(
                ctx, origin -> "sb-access-token=abc", (url, cookie, body) -> {
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
                ctx, origin -> "sb-access-token=abc", (url, cookie, body) -> 200);
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
        TaxotticUploader.upload(ctx, origin -> "sb-access-token=abc", (url, cookie, body) -> {
            posted[0] = url;
            sent[0] = body;
            return 200;
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
                ctx, origin -> "sb-access-token=abc",
                (url, cookie, body) -> ++calls[0] == 1 ? 200 : 500);
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
