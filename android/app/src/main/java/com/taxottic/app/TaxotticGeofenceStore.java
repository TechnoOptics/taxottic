package com.taxottic.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.location.Location;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Durable state for the geofence resurrection net.
 *
 * Everything here has to survive the app process being killed, because
 * that is the exact condition the feature exists to recover from. The
 * places we monitor, the health of the last resurrection attempt, and
 * any location fixes captured while the WebView was dead all live on
 * disk, never in memory only.
 *
 * Two stores, deliberately separate:
 *
 *   1. SharedPreferences for small structured state (places, health).
 *      Cheap to read from a BroadcastReceiver that has roughly ten
 *      seconds of life.
 *   2. A JSONL file for captured location fixes. Appending a line is
 *      the cheapest durable write available and it does not need the
 *      whole buffer parsed to add one point.
 *
 * Why a disk buffer exists at all: the @capgo plugin routes every GPS
 * fix through a saved Capacitor PluginCall
 * (BackgroundGeolocation.java:519-535) and drops the fix on the floor
 * with no log when the bridge is gone. A resurrection that captured
 * points through that path would capture nothing. So the resurrection
 * service owns its own capture and its own buffer, and the WebView
 * drains it on next open.
 */
final class TaxotticGeofenceStore {

    private static final String TAG = "TaxotticGeofence";

    private static final String PREFS = "TaxotticGeofenceState";

    private static final String KEY_PLACES = "places";
    private static final String KEY_REGISTERED_AT = "registeredAtMs";
    private static final String KEY_REGISTERED_COUNT = "registeredCount";
    private static final String KEY_REGISTRATION_ERROR = "registrationError";
    private static final String KEY_ARM_STATE = "armState";
    private static final String KEY_LAST_EVENT = "lastEvent";
    private static final String KEY_LAST_CAPTURE = "lastCapture";
    private static final String KEY_BUFFER_OVERFLOW = "bufferOverflow";
    private static final String KEY_CAPTURE_RUNNING = "captureRunning";

    /**
     * How many places we ever monitor.
     *
     * Android's own ceiling is 100 geofences per app, so this is not an
     * Android constraint. It is set by three things:
     *
     *   1. iOS caps region monitoring at 20 regions per app, hard, and
     *      the same server-computed place list feeds both platforms.
     *      Staying well under 20 leaves headroom for anything else that
     *      ever needs a region.
     *   2. Every monitored region costs standby power. The value falls
     *      off a cliff after home and work: those are where the phone
     *      sits still for many hours, which is exactly the condition
     *      that kills the process.
     *   3. A larger mesh means more spurious exits (walking the dog),
     *      each of which starts a location foreground service.
     *
     * Eight covers home, work, and the handful of habitual stops the
     * clustering finds, with room to spare.
     */
    static final int MAX_PLACES = 8;

    /** Arm states, reported to JS and forwarded in the heartbeat. */
    static final String ARM_ARMED = "armed";
    static final String ARM_NO_PLACES = "disarmed_no_places";
    static final String ARM_NO_BACKGROUND_PERMISSION = "disarmed_no_background_permission";
    static final String ARM_REGISTRATION_FAILED = "disarmed_registration_failed";

    /** Outcomes of a single geofence transition. */
    static final String OUTCOME_STARTED = "started";
    static final String OUTCOME_ENTER_IGNORED = "enter_ignored";
    static final String OUTCOME_NO_BACKGROUND_PERMISSION = "blocked_no_background_permission";
    static final String OUTCOME_SERVICE_START_DENIED = "blocked_service_start_denied";

    /** Outcomes of a resurrection capture session. */
    static final String CAPTURE_FIXES = "capturing";
    static final String CAPTURE_BLIND = "blind_no_fix";
    static final String CAPTURE_ENDED = "ended";
    static final String CAPTURE_PROVIDER_OFF = "location_services_off";

    private static final String BUFFER_FILE = "mileage-resurrection-buffer.jsonl";

    /**
     * Roughly 2 MB of JSONL, about 12,000 fixes, about three and a half
     * hours of one-per-second driving. Past this we stop appending and
     * raise bufferOverflow rather than filling the user's storage. The
     * overflow is surfaced, not swallowed.
     */
    private static final long BUFFER_MAX_BYTES = 2L * 1024L * 1024L;

    private static final Object BUFFER_LOCK = new Object();

    private TaxotticGeofenceStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ---------------------------------------------------------------
    // Places
    // ---------------------------------------------------------------

    /**
     * Replace the monitored place list. Input is trusted to be the
     * server's ranked list; we truncate to MAX_PLACES and drop anything
     * structurally invalid rather than registering a garbage region.
     */
    static List<JSONObject> savePlaces(Context context, JSONArray incoming) {
        List<JSONObject> kept = new ArrayList<>();
        if (incoming != null) {
            for (int i = 0; i < incoming.length() && kept.size() < MAX_PLACES; i++) {
                JSONObject place = incoming.optJSONObject(i);
                if (place == null) continue;
                String id = place.optString("id", "");
                double lat = place.optDouble("latitude", Double.NaN);
                double lng = place.optDouble("longitude", Double.NaN);
                double radius = place.optDouble("radius", 0);
                if (id.isEmpty()) continue;
                if (Double.isNaN(lat) || Double.isNaN(lng)) continue;
                if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
                // Android's geofencing is unreliable below about 100 m
                // and there is no point monitoring a whole town.
                if (radius < 100) radius = 100;
                if (radius > 500) radius = 500;
                JSONObject clean = new JSONObject();
                try {
                    clean.put("id", id);
                    clean.put("latitude", lat);
                    clean.put("longitude", lng);
                    clean.put("radius", radius);
                    clean.put("label", place.optString("label", "stop"));
                } catch (JSONException e) {
                    continue;
                }
                kept.add(clean);
            }
        }
        JSONArray out = new JSONArray();
        for (JSONObject place : kept) out.put(place);
        prefs(context).edit().putString(KEY_PLACES, out.toString()).apply();
        return kept;
    }

    static List<JSONObject> getPlaces(Context context) {
        List<JSONObject> places = new ArrayList<>();
        String raw = prefs(context).getString(KEY_PLACES, null);
        if (raw == null || raw.isEmpty()) return places;
        try {
            JSONArray parsed = new JSONArray(raw);
            for (int i = 0; i < parsed.length(); i++) {
                JSONObject place = parsed.optJSONObject(i);
                if (place != null) places.add(place);
            }
        } catch (JSONException e) {
            Log.e(TAG, "Stored places unreadable, treating as empty", e);
        }
        return places;
    }

    static JSONObject findPlace(Context context, String id) {
        for (JSONObject place : getPlaces(context)) {
            if (id.equals(place.optString("id"))) return place;
        }
        return null;
    }

    static void clearPlaces(Context context) {
        prefs(context).edit().remove(KEY_PLACES).apply();
    }

    // ---------------------------------------------------------------
    // Health
    // ---------------------------------------------------------------

    static void recordRegistration(Context context, String armState, int count, String error) {
        prefs(context)
                .edit()
                .putString(KEY_ARM_STATE, armState)
                .putInt(KEY_REGISTERED_COUNT, count)
                .putLong(KEY_REGISTERED_AT, System.currentTimeMillis())
                .putString(KEY_REGISTRATION_ERROR, error == null ? "" : error)
                .apply();
    }

    static void recordTransition(Context context, String placeId, boolean enter, String outcome, String detail) {
        try {
            JSONObject event = new JSONObject();
            event.put("placeId", placeId);
            event.put("transition", enter ? "enter" : "exit");
            event.put("outcome", outcome);
            event.put("detail", detail == null ? "" : detail);
            event.put("atMs", System.currentTimeMillis());
            prefs(context).edit().putString(KEY_LAST_EVENT, event.toString()).apply();
        } catch (JSONException e) {
            Log.e(TAG, "Could not record geofence transition", e);
        }
    }

    /**
     * @param running whether a capture session is still live. Passed
     *                explicitly rather than derived from {@code state},
     *                because "blind" is a running session that cannot
     *                see location and "gave up while blind" is a
     *                stopped one, and deriving the flag from the state
     *                string conflated the two.
     */
    static void recordCapture(
            Context context, String state, String detail, int fixCount, long startedAtMs, boolean running) {
        try {
            JSONObject capture = new JSONObject();
            capture.put("state", state);
            capture.put("detail", detail == null ? "" : detail);
            capture.put("fixCount", fixCount);
            capture.put("startedAtMs", startedAtMs);
            capture.put("updatedAtMs", System.currentTimeMillis());
            prefs(context)
                    .edit()
                    .putString(KEY_LAST_CAPTURE, capture.toString())
                    .putBoolean(KEY_CAPTURE_RUNNING, running)
                    .apply();
        } catch (JSONException e) {
            Log.e(TAG, "Could not record capture state", e);
        }
    }

    /**
     * A running flag is only believed while it is being refreshed.
     *
     * If the OS kills the process outright, onDestroy never runs and
     * the flag stays true forever. A stuck flag would make every later
     * geofence exit decide a capture is already in progress and do
     * nothing, which would silently disable the entire resurrection net
     * for good. That is the class of failure this feature exists to
     * remove, so it must not be reintroduced by its own bookkeeping.
     *
     * The service checkpoints roughly every thirty seconds while
     * capturing, and on every state change. Twenty minutes of silence
     * therefore means it is gone. Being wrong costs nothing: a second
     * start of a service that really is running returns early.
     */
    private static final long CAPTURE_FLAG_STALE_MS = 20 * 60 * 1000L;

    static boolean isCaptureRunning(Context context) {
        SharedPreferences p = prefs(context);
        if (!p.getBoolean(KEY_CAPTURE_RUNNING, false)) return false;
        String raw = p.getString(KEY_LAST_CAPTURE, "");
        if (raw.isEmpty()) return false;
        try {
            long updatedAtMs = new JSONObject(raw).optLong("updatedAtMs", 0);
            return System.currentTimeMillis() - updatedAtMs < CAPTURE_FLAG_STALE_MS;
        } catch (JSONException e) {
            return false;
        }
    }

    /**
     * The whole health picture in one object, for the JS bridge and the
     * heartbeat. Deliberately includes the failure fields, because a
     * status object that can only say "fine" is how the current bug
     * stayed invisible for a week.
     */
    static JSONObject snapshot(Context context) throws JSONException {
        SharedPreferences p = prefs(context);
        JSONObject out = new JSONObject();
        out.put("armState", p.getString(KEY_ARM_STATE, ARM_NO_PLACES));
        out.put("registeredCount", p.getInt(KEY_REGISTERED_COUNT, 0));
        out.put("registeredAtMs", p.getLong(KEY_REGISTERED_AT, 0));
        String registrationError = p.getString(KEY_REGISTRATION_ERROR, "");
        out.put("registrationError", registrationError.isEmpty() ? JSONObject.NULL : registrationError);
        out.put("placeCount", getPlaces(context).size());
        String lastEvent = p.getString(KEY_LAST_EVENT, "");
        out.put("lastEvent", lastEvent.isEmpty() ? JSONObject.NULL : new JSONObject(lastEvent));
        String lastCapture = p.getString(KEY_LAST_CAPTURE, "");
        out.put("lastCapture", lastCapture.isEmpty() ? JSONObject.NULL : new JSONObject(lastCapture));
        out.put("captureRunning", p.getBoolean(KEY_CAPTURE_RUNNING, false));
        out.put("bufferOverflow", p.getBoolean(KEY_BUFFER_OVERFLOW, false));
        out.put("bufferedFixes", countBufferedFixes(context));
        return out;
    }

    // ---------------------------------------------------------------
    // Fix buffer
    // ---------------------------------------------------------------

    private static File bufferFile(Context context) {
        return new File(context.getApplicationContext().getFilesDir(), BUFFER_FILE);
    }

    /**
     * Append one fix. Returns false if the write was refused, which the
     * caller must treat as a visible failure and not as success.
     *
     * @param source which wake source started the capture session, from
     *               TaxotticResurrectionService.SOURCE_*.
     */
    static boolean appendFix(Context context, Location location, String placeId, String source) {
        synchronized (BUFFER_LOCK) {
            File file = bufferFile(context);
            if (file.length() > BUFFER_MAX_BYTES) {
                prefs(context).edit().putBoolean(KEY_BUFFER_OVERFLOW, true).apply();
                return false;
            }
            try {
                JSONObject fix = new JSONObject();
                fix.put("latitude", location.getLatitude());
                fix.put("longitude", location.getLongitude());
                fix.put("accuracy", location.hasAccuracy() ? (double) location.getAccuracy() : JSONObject.NULL);
                fix.put("altitude", location.hasAltitude() ? location.getAltitude() : JSONObject.NULL);
                fix.put("speed", location.hasSpeed() ? (double) location.getSpeed() : JSONObject.NULL);
                fix.put("bearing", location.hasBearing() ? (double) location.getBearing() : JSONObject.NULL);
                fix.put("simulated", location.isFromMockProvider());
                // WALL CLOCK, and it cannot be trusted on its own.
                //
                // location.getTime() is a wall-clock value the platform
                // reconstructs from a boot anchor. If that anchor moves
                // (clock correction, NTP step, doze resume) every fix in
                // a batch shifts by the SAME offset, and the batch stays
                // perfectly self-consistent while pointing at the wrong
                // time. Nothing downstream can detect it: the points are
                // a faithful copy of a real drive, just relived.
                //
                // Measured 2026-08-12: one Home-to-Zinpro commute landed
                // twice, the copies 100% identical in space (166 of 166
                // points within 9 m of the other path) and offset by a
                // constant 19.3 minutes in time. It double-counted 11.98
                // miles of deduction, and the plausible-jump gate could
                // not catch it because nothing inside either copy is
                // implausible.
                fix.put("time", location.getTime());
                // MONOTONIC, and this is the one that survives.
                //
                // elapsedRealtimeNanos counts from boot and is immune to
                // clock changes, which is exactly why Android documents
                // it as the reliable timestamp for comparing fixes. Read
                // back in readBuffer() against the CURRENT elapsed clock,
                // it yields a wall time that cannot drift as a batch.
                fix.put("elapsedNanos", location.getElapsedRealtimeNanos());
                // Which wake source started the session that captured
                // this fix. Defaulted rather than allowed to be null so
                // fixes buffered by older builds and fixes buffered by
                // this one read the same way downstream.
                fix.put("source", source == null || source.isEmpty()
                        ? "geofence_resurrection" : source);
                fix.put("placeId", placeId == null ? JSONObject.NULL : placeId);
                try (OutputStreamWriter writer = new OutputStreamWriter(
                        new FileOutputStream(file, true), StandardCharsets.UTF_8)) {
                    writer.write(fix.toString());
                    writer.write("\n");
                }
                return true;
            } catch (JSONException | IOException e) {
                Log.e(TAG, "Could not buffer resurrection fix", e);
                return false;
            }
        }
    }

    static int countBufferedFixes(Context context) {
        synchronized (BUFFER_LOCK) {
            File file = bufferFile(context);
            if (!file.exists()) return 0;
            int lines = 0;
            try (RandomAccessFile reader = new RandomAccessFile(file, "r")) {
                while (reader.readLine() != null) lines++;
            } catch (IOException e) {
                Log.e(TAG, "Could not count buffered fixes", e);
                return 0;
            }
            return lines;
        }
    }

    /**
     * Re-derive a fix's wall-clock time from the monotonic clock.
     *
     * The stored `time` is whatever the platform believed when the fix
     * was recorded, and a boot-anchor shift moves a whole batch of them
     * by a constant offset without making any single one look wrong. The
     * monotonic clock cannot move that way, so:
     *
     *     trueTime = now - (elapsedNow - elapsedAtFix)
     *
     * "how long ago was this, really" answered against the clock that
     * only ever counts forward. A batch buffered across a clock
     * correction now lands where it actually happened.
     *
     * Falls back to the stored time when elapsedNanos is absent, which
     * is every fix written by a build older than this one. Those keep
     * exactly the behaviour they had rather than being silently shifted
     * by a value that was never recorded for them.
     *
     * Deliberately applied on READ, not on write: at write time the
     * anchor may already be wrong, and there is nothing to compare
     * against. At read time we hold both clocks at once.
     */
    private static JSONObject correctTime(JSONObject fix) {
        long elapsedAtFix = fix.optLong("elapsedNanos", 0L);
        if (elapsedAtFix <= 0L) return fix;
        try {
            long agoMs = (SystemClock.elapsedRealtimeNanos() - elapsedAtFix) / 1_000_000L;
            // A negative age means the fix claims to be from the future,
            // which happens only if the device rebooted between write and
            // read: elapsedRealtime restarts at zero, so the stored value
            // belongs to a different epoch and is meaningless. Keep the
            // wall clock in that case, it is the better of two bad
            // options.
            if (agoMs < 0L) return fix;
            long derived = System.currentTimeMillis() - agoMs;
            long stored = fix.optLong("time", 0L);
            if (stored > 0L) {
                // Record the disagreement so the field can tell us how
                // often this fires and by how much, instead of the fix
                // being invisible once it works.
                fix.put("timeDriftMs", derived - stored);
            }
            fix.put("time", derived);
        } catch (JSONException ignored) {
            // Leave the fix exactly as stored.
        }
        return fix;
    }

    /** Read every buffered fix without removing it. */
    static JSONArray readBuffer(Context context) {
        JSONArray out = new JSONArray();
        synchronized (BUFFER_LOCK) {
            File file = bufferFile(context);
            if (!file.exists()) return out;
            try (RandomAccessFile reader = new RandomAccessFile(file, "r")) {
                String line;
                while ((line = reader.readLine()) != null) {
                    if (line.isEmpty()) continue;
                    try {
                        out.put(correctTime(new JSONObject(line)));
                    } catch (JSONException ignored) {
                        // One corrupt line must not lose the rest.
                    }
                }
            } catch (IOException e) {
                Log.e(TAG, "Could not read resurrection buffer", e);
            }
        }
        return out;
    }

    /**
     * Drop the first {@code count} buffered fixes. Called only after JS
     * has confirmed the upload, so a failed upload never loses points.
     */
    static void consumeBuffer(Context context, int count) {
        if (count <= 0) return;
        synchronized (BUFFER_LOCK) {
            File file = bufferFile(context);
            if (!file.exists()) return;
            List<String> remaining = new ArrayList<>();
            try (RandomAccessFile reader = new RandomAccessFile(file, "r")) {
                String line;
                int index = 0;
                while ((line = reader.readLine()) != null) {
                    if (index >= count && !line.isEmpty()) remaining.add(line);
                    index++;
                }
            } catch (IOException e) {
                Log.e(TAG, "Could not rewrite resurrection buffer", e);
                return;
            }
            try (OutputStreamWriter writer = new OutputStreamWriter(
                    new FileOutputStream(file, false), StandardCharsets.UTF_8)) {
                for (String line : remaining) {
                    writer.write(line);
                    writer.write("\n");
                }
            } catch (IOException e) {
                Log.e(TAG, "Could not truncate resurrection buffer", e);
                return;
            }
            if (remaining.isEmpty()) {
                prefs(context).edit().putBoolean(KEY_BUFFER_OVERFLOW, false).apply();
            }
        }
    }
}
