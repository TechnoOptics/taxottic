package com.taxottic.app;

import static org.junit.Assert.assertEquals;

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

    private static Location fixAt(long timeMs) {
        Location l = new Location("test");
        l.setLatitude(41.5);
        l.setLongitude(-93.6);
        l.setAccuracy(8f);
        l.setTime(timeMs);
        return l;
    }
}
