package com.taxottic.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import android.content.Context;

import androidx.test.core.app.ApplicationProvider;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;

/**
 * The upload outcome survives the process and reaches the snapshot.
 *
 * lib/mileage/native-upload-call-site.test.ts proves the service CALLS
 * the uploader and that recordUpload is wired to the result. It reads
 * source, so it cannot prove the recorded value is readable afterwards.
 * This file executes it: write an outcome, read the snapshot the bridge
 * resolves, and find the reason in it.
 *
 * That round trip is the whole telemetry chain on this side of the
 * bridge, and it is the only way to find out whether the native uploader
 * works on a real phone. If the reason does not make it into
 * snapshot(), the build ships and a device returning "no_session" on
 * every run is indistinguishable from one posting perfectly.
 */
@RunWith(RobolectricTestRunner.class)
public class TaxotticUploadRecordTest {

    private Context ctx;

    @Before
    public void setUp() {
        ctx = ApplicationProvider.getApplicationContext();
    }

    @Test
    public void thereIsNoUploadOnADeviceThatHasNeverTriedOne() throws Exception {
        // NULL rather than a made-up default, so an old build and a
        // build whose uploader never ran are not confused with a build
        // whose uploader ran and found nothing.
        JSONObject fresh = TaxotticGeofenceStore.snapshot(ctx);
        assertTrue("lastUpload is missing from the snapshot entirely",
                fresh.has("lastUpload"));
        assertEquals(JSONObject.NULL, fresh.get("lastUpload"));
    }

    @Test
    public void theReasonReachesTheSnapshot() throws Exception {
        TaxotticGeofenceStore.recordUpload(ctx, "cold_start_backlog", 0, "no_session");

        JSONObject upload = TaxotticGeofenceStore.snapshot(ctx).getJSONObject("lastUpload");
        // The failure mode this column set exists to expose: the
        // cold-started process has no Supabase cookie, so nothing is
        // posted while every other health field stays green.
        assertEquals("no_session", upload.getString("reason"));
        assertEquals("cold_start_backlog", upload.getString("trigger"));
        assertEquals(0, upload.getInt("posted"));
        assertTrue("the outcome carries no timestamp", upload.getLong("atMs") > 0);
    }

    @Test
    public void theLatestOutcomeReplacesTheLastOne() throws Exception {
        TaxotticGeofenceStore.recordUpload(ctx, "cold_start_backlog", 0, "no_session");
        TaxotticGeofenceStore.recordUpload(ctx, "capture_ended", 14, "ok");

        JSONObject upload = TaxotticGeofenceStore.snapshot(ctx).getJSONObject("lastUpload");
        assertEquals("ok", upload.getString("reason"));
        assertEquals("capture_ended", upload.getString("trigger"));
        assertEquals(14, upload.getInt("posted"));
    }

    /**
     * A null reason must not take the field out of the snapshot. The
     * heartbeat reads lastUpload.reason; an absent key there is the same
     * null as "this device never tried", which is the one distinction
     * the column exists to make.
     */
    @Test
    public void recordsAnEmptyReasonRatherThanDroppingTheRow() throws Exception {
        TaxotticGeofenceStore.recordUpload(ctx, null, 0, null);

        JSONObject upload = TaxotticGeofenceStore.snapshot(ctx).getJSONObject("lastUpload");
        assertEquals("", upload.getString("reason"));
        assertEquals("", upload.getString("trigger"));
    }
}
