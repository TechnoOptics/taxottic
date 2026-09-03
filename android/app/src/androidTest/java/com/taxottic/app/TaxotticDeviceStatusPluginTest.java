package com.taxottic.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import android.content.Context;
import android.os.Build;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import com.getcapacitor.JSObject;
import com.taxottic.app.TaxotticDeviceStatusPlugin.ExitRecord;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * Pins the shape of the exit-info payload the heartbeat stores in
 * mileage_device_status.last_exit_detail.
 *
 * Why the shape matters: for ten days the reporter's Galaxy Z Fold 5
 * had every multi-day capture gap followed by a harmless wake-source
 * process death (low_memory at importance 400 after a resurrection
 * drive finished), and reporting only the newest record meant that
 * later death overwrote the tracker's own. Four outages, no cause. The
 * one record that did survive could not even be attributed to the app
 * process versus the WebView's sandboxed renderer, because the process
 * name was never kept.
 *
 * ApplicationExitInfo has no public constructor, so the shaping is a
 * pure method over a plain record and that is what runs here. What this
 * proves is the JSON the bridge hands to JS. What it cannot prove is
 * what the OS puts in the ring buffer.
 */
@RunWith(AndroidJUnit4.class)
public class TaxotticDeviceStatusPluginTest {

    private static final String APP = "com.taxottic.app";
    private static final String RENDERER =
            "com.taxottic.app:sandboxed_process0:org.chromium.content.app.SandboxedProcessService0:0";

    private static final long NEWEST_AT = 1_756_100_000_000L;
    private static final long MIDDLE_AT = 1_756_000_000_000L;
    private static final long OLDEST_AT = 1_755_900_000_000L;

    /**
     * The production fingerprint, newest first as the OS returns it: a
     * wake-source low-memory kill of the app process at importance 400,
     * then the SIGKILL of a live foreground-service process that carried
     * a breadcrumb, then a renderer death with nothing attached.
     */
    private static List<ExitRecord> fold5Week() {
        return Arrays.asList(
                record(APP, ApplicationExitInfo.REASON_LOW_MEMORY, 0, 400, NEWEST_AT,
                        "lowmem", "resurrection:done", 41_000, 88_000),
                record(APP, ApplicationExitInfo.REASON_SIGNALED, 9, 125, MIDDLE_AT,
                        "signal 9", "tracking:active", 52_000, 104_000),
                record(RENDERER, ApplicationExitInfo.REASON_SIGNALED, 9, 125, OLDEST_AT,
                        null, null, 12_000, 30_000));
    }

    private static ExitRecord record(String processName, int reason, int status,
            int importance, long timestamp, String description, String breadcrumb,
            long pssKb, long rssKb) {
        byte[] summary = breadcrumb == null
                ? null
                : breadcrumb.getBytes(StandardCharsets.UTF_8);
        return new ExitRecord(processName, reason, status, importance, timestamp,
                description, summary, pssKb, rssKb);
    }

    private static JSONArray history(JSObject payload) throws Exception {
        assertTrue("history must be present", payload.has("history"));
        return payload.getJSONArray("history");
    }

    @Test
    public void historyReportsEveryFetchedRecordNewestFirst() throws Exception {
        JSONArray history = history(TaxotticDeviceStatusPlugin.shapeExitInfo(fold5Week()));

        assertEquals("one entry per record, not just the newest", 3, history.length());
        assertEquals(NEWEST_AT, history.getJSONObject(0).getLong("timestamp"));
        assertEquals(MIDDLE_AT, history.getJSONObject(1).getLong("timestamp"));
        assertEquals(OLDEST_AT, history.getJSONObject(2).getLong("timestamp"));
    }

    @Test
    public void historyEntriesNameTheDyingProcess() throws Exception {
        JSONArray history = history(TaxotticDeviceStatusPlugin.shapeExitInfo(fold5Week()));

        for (int i = 0; i < history.length(); i++) {
            assertTrue("entry " + i + " must carry processName",
                    history.getJSONObject(i).has("processName"));
        }
        assertEquals(APP, history.getJSONObject(0).getString("processName"));
        assertEquals(APP, history.getJSONObject(1).getString("processName"));
        assertEquals("a renderer death must be attributable as one",
                RENDERER, history.getJSONObject(2).getString("processName"));
    }

    @Test
    public void historyEntriesCarryTheForensicFields() throws Exception {
        JSONArray history = history(TaxotticDeviceStatusPlugin.shapeExitInfo(fold5Week()));

        JSONObject newest = history.getJSONObject(0);
        assertEquals(ApplicationExitInfo.REASON_LOW_MEMORY, newest.getInt("reason"));
        assertEquals("low_memory", newest.getString("reasonName"));
        assertEquals(0, newest.getInt("status"));
        assertEquals(400, newest.getInt("importance"));
        assertEquals(NEWEST_AT, newest.getLong("timestamp"));
        assertEquals("lowmem", newest.getString("description"));
        assertEquals("resurrection:done", newest.getString("breadcrumb"));

        JSONObject oldest = history.getJSONObject(2);
        assertEquals(9, oldest.getInt("status"));
        assertFalse("no description on the record means no key",
                oldest.has("description"));
        assertFalse("no breadcrumb on the record means no key",
                oldest.has("breadcrumb"));
    }

    @Test
    public void historyBreadcrumbIsBoundedTo200Chars() throws Exception {
        char[] filler = new char[300];
        Arrays.fill(filler, 'x');
        List<ExitRecord> one = Collections.singletonList(record(APP,
                ApplicationExitInfo.REASON_OTHER, 0, 400, NEWEST_AT, null,
                new String(filler), 0, 0));

        JSONArray history = history(TaxotticDeviceStatusPlugin.shapeExitInfo(one));

        assertEquals(200, history.getJSONObject(0).getString("breadcrumb").length());
    }

    /**
     * The top-level fields are what device-status.ts reads (reasonName,
     * timestamp) and what the existing SQL over last_exit_detail keys on.
     * history is additive; these must not move.
     */
    @Test
    public void topLevelFieldsStillDescribeTheNewestRecord() throws Exception {
        JSObject payload = TaxotticDeviceStatusPlugin.shapeExitInfo(fold5Week());

        assertTrue(payload.getBoolean("available"));
        assertEquals(ApplicationExitInfo.REASON_LOW_MEMORY, payload.getInt("reason"));
        assertEquals("low_memory", payload.getString("reasonName"));
        assertEquals(0, payload.getInt("status"));
        assertEquals(NEWEST_AT, payload.getLong("timestamp"));
        assertEquals(400, payload.getInt("importance"));
        assertFalse("importance 400 is a cached process, not a live service",
                payload.getBoolean("fgsWasAlive"));
        assertEquals(41_000, payload.getLong("pssKb"));
        assertEquals(88_000, payload.getLong("rssKb"));
        assertEquals("lowmem", payload.getString("description"));
        assertEquals("resurrection:done", payload.getString("breadcrumb"));
    }

    @Test
    public void fgsWasAliveWhenTheNewestDeathWasAtForegroundServiceImportance() throws Exception {
        List<ExitRecord> one = Collections.singletonList(record(APP,
                ApplicationExitInfo.REASON_SIGNALED, 9,
                ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE,
                NEWEST_AT, null, null, 0, 0));

        assertTrue(TaxotticDeviceStatusPlugin.shapeExitInfo(one).getBoolean("fgsWasAlive"));
    }

    @Test
    public void noRecordsIsReportedAsUnavailable() throws Exception {
        JSObject payload = TaxotticDeviceStatusPlugin.shapeExitInfo(
                Collections.<ExitRecord>emptyList());

        assertFalse(payload.getBoolean("available"));
        assertFalse(payload.has("history"));
    }

    /**
     * Samsung's "Deep sleeping apps" sets RUN_ANY_IN_BACKGROUND to ignore,
     * which is a different switch from battery optimization and was never
     * reported. isBackgroundRestricted() is the platform's read of it.
     */
    @Test
    public void statusPayloadReportsBackgroundRestriction() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertTrue("this test needs API 28+ to mean anything",
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.P);

        JSObject status = TaxotticDeviceStatusPlugin.buildStatus(context, false);

        assertTrue(status.has("isBackgroundRestricted"));
        assertTrue("must be a boolean, never a string or null",
                status.get("isBackgroundRestricted") instanceof Boolean);
        ActivityManager am =
                (ActivityManager) context.getSystemService(Context.ACTIVITY_SERVICE);
        assertEquals(am.isBackgroundRestricted(), status.getBoolean("isBackgroundRestricted"));
        assertEquals("android", status.getString("platform"));
        assertTrue(status.get("batteryOptimized") instanceof Boolean);
    }

    /** The same flag rides the exit payload so it lands in the jsonb
     *  column without a schema change. */
    @Test
    public void exitPayloadCarriesBackgroundRestriction() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();

        JSObject payload = TaxotticDeviceStatusPlugin.shapeExitInfo(fold5Week());
        TaxotticDeviceStatusPlugin.putBackgroundRestricted(context, payload);

        assertTrue(payload.get("isBackgroundRestricted") instanceof Boolean);
    }
}
