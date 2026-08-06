package com.taxottic.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
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
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/**
 * Durable storage for car-connection signal events.
 *
 * Deliberately a sibling of TaxotticGeofenceStore rather than an
 * extension of it. The geofence store owns the resurrection net's own
 * state (which places, is capture running, buffered fixes). This owns a
 * stream of observations about the vehicle. They are written by
 * different receivers, drained by different consumers, and it must be
 * possible to clear one without touching the other.
 *
 * Same durability reasoning as the geofence store, and for the same
 * reason: the whole point of a manifest-declared receiver is that it
 * runs when the process has been dead for hours, so anything it learns
 * that lives only in memory is lost the moment the receiver returns.
 * Signals go to disk on the receiver's own thread, before it returns.
 *
 * THIS CLASS DECIDES NOTHING. It records what happened and when. Whether
 * a car Bluetooth connect at 07:41 means a drive started is a scoring
 * question answered elsewhere, on more evidence than one event. The one
 * decision made near here is whether to start a foreground service, and
 * that lives in the receiver, not in the store.
 */
final class TaxotticCarSignalStore {

    private static final String TAG = "TaxotticCarSignals";

    private static final String PREFS = "TaxotticCarSignalState";

    private static final String KEY_SALT = "deviceIdSalt";
    private static final String KEY_SEQ = "seq";
    private static final String KEY_DROPPED = "dropped";
    private static final String KEY_LAST_SIGNAL = "lastSignal";
    private static final String KEY_LAST_WAKE_OUTCOME = "lastWakeOutcome";
    private static final String KEY_LAST_WAKE_AT = "lastWakeAtMs";
    private static final String KEY_BT_PERMISSION = "bluetoothPermission";
    private static final String KEY_BT_PERMISSION_ASKED = "bluetoothPermissionAsked";
    private static final String KEY_VEHICLE_CONNECTS = "vehicleConnects";
    private static final String KEY_VEHICLE_DISCONNECTS = "vehicleDisconnects";
    private static final String KEY_OTHER_AUDIO_EVENTS = "otherAudioEvents";
    private static final String KEY_IGNORED_EVENTS = "ignoredEvents";
    private static final String KEY_PROJECTION_TYPE = "projectionType";
    private static final String KEY_PROJECTION_OBSERVED = "projectionObserved";
    private static final String KEY_PROJECTION_ERROR = "projectionError";

    /** Event schema version. Bump when a field's meaning changes. */
    static final int SCHEMA_VERSION = 1;

    /** Signal kinds. */
    static final String KIND_BLUETOOTH = "bluetooth";
    static final String KIND_PROJECTION = "projection";
    static final String KIND_POWER = "power";

    /** Connection states. Every signal has exactly one of these. */
    static final String STATE_CONNECTED = "connected";
    static final String STATE_DISCONNECTED = "disconnected";

    /**
     * What we did about a signal. Named outcomes rather than a boolean,
     * because "we did not start capture" has four completely different
     * meanings and flattening them is how a silent failure hides.
     */
    static final String WAKE_STARTED = "started";
    static final String WAKE_ALREADY_RUNNING = "already_running";
    static final String WAKE_NO_BACKGROUND_PERMISSION = "blocked_no_background_permission";
    static final String WAKE_SERVICE_START_DENIED = "blocked_service_start_denied";
    static final String WAKE_NOT_A_WAKE_SOURCE = "not_a_wake_source";
    static final String WAKE_NOT_VEHICLE_CLASS = "not_vehicle_class";

    /** Runtime permission states reported to JS. */
    static final String BT_PERMISSION_GRANTED = "granted";
    static final String BT_PERMISSION_DENIED = "denied";
    static final String BT_PERMISSION_NOT_REQUESTED = "not_requested";
    static final String BT_PERMISSION_NOT_REQUIRED = "not_required";

    private static final String SIGNAL_FILE = "mileage-car-signals.jsonl";

    /**
     * The buffer is a ring, not a dam.
     *
     * The geofence fix buffer stops appending when it fills, because a
     * dropped GPS fix is a hole in a route that must never be silently
     * invented. Signals are the opposite: they are only useful while
     * fresh, and the newest one is always the most informative. So when
     * this fills we drop the OLDEST and count the drop, rather than
     * refusing the newest and going deaf.
     *
     * This is also the "no-op safely if nothing consumes it" guarantee.
     * If the scoring engine never ships, or ships and then breaks, this
     * file settles at a few hundred kilobytes and stays there forever
     * instead of growing without bound on a user's phone.
     */
    private static final int MAX_SIGNALS = 400;

    /**
     * Rewriting the file is O(n), so do not do it on every append once
     * full. Let it run to MAX_SIGNALS + SLACK, then compact back to
     * MAX_SIGNALS in one pass.
     */
    private static final int COMPACT_SLACK = 100;

    private static final Object FILE_LOCK = new Object();

    private TaxotticCarSignalStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // ------------------------------------------------------------------
    // Event construction
    // ------------------------------------------------------------------

    /**
     * Start an event with the fields every signal carries.
     *
     * Three timestamps, on purpose:
     *
     *   atMs               wall clock. Human-readable, joins to server
     *                      rows, and can jump backwards when the network
     *                      time or the user's clock changes.
     *   elapsedRealtimeMs  monotonic since boot, counts time in deep
     *                      sleep. This is the one to difference when
     *                      asking "how long after the Bluetooth connect
     *                      did the phone start moving", because it
     *                      cannot go backwards.
     *   bootAtMs           atMs minus elapsedRealtimeMs, rounded to the
     *                      second. Two events with the same bootAtMs are
     *                      from the same boot, so their
     *                      elapsedRealtimeMs values are comparable.
     *                      Different bootAtMs means the device rebooted
     *                      between them and only atMs may be differenced.
     *
     * Emitting the monotonic clock without a way to know whether two
     * readings share an origin would be worse than not emitting it,
     * because it would look usable and quietly be wrong across a reboot.
     */
    static JSONObject newEvent(Context context, String kind, String state) throws JSONException {
        long atMs = System.currentTimeMillis();
        long elapsed = SystemClock.elapsedRealtime();
        JSONObject event = new JSONObject();
        event.put("v", SCHEMA_VERSION);
        event.put("seq", nextSeq(context));
        event.put("kind", kind);
        event.put("state", state);
        event.put("atMs", atMs);
        event.put("elapsedRealtimeMs", elapsed);
        event.put("bootAtMs", ((atMs - elapsed) / 1000L) * 1000L);
        // Per-kind fields are always present and null when they do not
        // apply, so a consumer never has to test for key existence.
        event.put("deviceId", JSONObject.NULL);
        event.put("deviceName", JSONObject.NULL);
        event.put("deviceMajorClass", JSONObject.NULL);
        event.put("deviceClass", JSONObject.NULL);
        event.put("deviceMajorClassRaw", JSONObject.NULL);
        event.put("deviceClassRaw", JSONObject.NULL);
        event.put("vehicleClass", JSONObject.NULL);
        event.put("plugged", JSONObject.NULL);
        event.put("projectionType", JSONObject.NULL);
        event.put("wakeAttempted", false);
        event.put("wakeOutcome", WAKE_NOT_A_WAKE_SOURCE);
        event.put("wakeDetail", "");
        return event;
    }

    private static long nextSeq(Context context) {
        SharedPreferences p = prefs(context);
        long next = p.getLong(KEY_SEQ, 0) + 1;
        // commit, not apply: a receiver can be killed the instant it
        // returns, and two events sharing a sequence number would make
        // the stream unorderable.
        p.edit().putLong(KEY_SEQ, next).commit();
        return next;
    }

    /**
     * Stable, non-reversible identifier for a Bluetooth peer.
     *
     * The scoring engine needs to know "this is the same device as last
     * Tuesday" and nothing more. A MAC address would answer that and
     * would also be a persistent hardware identifier for someone else's
     * property sitting in our app storage and, once drained, on our
     * server. Hashing with a per-install random salt answers the only
     * question anyone actually asks while making the stored value
     * useless for tracking a car across installs or across users.
     */
    static String deviceIdFor(Context context, String address) {
        if (address == null || address.isEmpty()) return null;
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            digest.update(salt(context).getBytes(StandardCharsets.UTF_8));
            byte[] hash = digest.digest(address.toUpperCase().getBytes(StandardCharsets.UTF_8));
            StringBuilder out = new StringBuilder(16);
            for (int i = 0; i < 8; i++) out.append(String.format("%02x", hash[i]));
            return out.toString();
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 is mandatory on every Android device, so this is
            // unreachable. Returning null loses the identifier rather
            // than falling back to the raw address.
            Log.e(TAG, "SHA-256 unavailable, cannot derive a device id", e);
            return null;
        }
    }

    private static String salt(Context context) {
        SharedPreferences p = prefs(context);
        String existing = p.getString(KEY_SALT, null);
        if (existing != null && !existing.isEmpty()) return existing;
        String fresh = UUID.randomUUID().toString();
        p.edit().putString(KEY_SALT, fresh).commit();
        return fresh;
    }

    // ------------------------------------------------------------------
    // Event persistence
    // ------------------------------------------------------------------

    /** Append one finished event and update the health counters. */
    static void record(Context context, JSONObject event) {
        Context app = context.getApplicationContext();
        String kind = event.optString("kind", "");
        String state = event.optString("state", "");
        boolean vehicle = event.optBoolean("vehicleClass", false);

        SharedPreferences p = prefs(app);
        SharedPreferences.Editor edit = p.edit();
        edit.putString(KEY_LAST_SIGNAL, event.toString());
        if (KIND_BLUETOOTH.equals(kind)) {
            if (vehicle && STATE_CONNECTED.equals(state)) {
                edit.putInt(KEY_VEHICLE_CONNECTS, p.getInt(KEY_VEHICLE_CONNECTS, 0) + 1);
            } else if (vehicle) {
                edit.putInt(KEY_VEHICLE_DISCONNECTS, p.getInt(KEY_VEHICLE_DISCONNECTS, 0) + 1);
            } else {
                edit.putInt(KEY_OTHER_AUDIO_EVENTS, p.getInt(KEY_OTHER_AUDIO_EVENTS, 0) + 1);
            }
        }
        if (event.optBoolean("wakeAttempted", false)) {
            edit.putString(KEY_LAST_WAKE_OUTCOME, event.optString("wakeOutcome", ""));
            edit.putLong(KEY_LAST_WAKE_AT, event.optLong("atMs", 0));
        }
        edit.commit();

        append(app, event);
    }

    /**
     * Count a Bluetooth event we chose not to log at all.
     *
     * Every headset, watch, keyboard and mouse the user owns produces
     * ACL broadcasts. Writing all of them to disk would turn a drive
     * signal log into a record of which peripherals someone owns and
     * when they wear them, for no gain: nothing downstream can use it.
     * The count alone answers the one question that matters, which is
     * whether Bluetooth broadcasts are reaching us at all. A zero here
     * with Bluetooth on and permission granted is the difference between
     * "no car connected" and "the receiver is not being delivered to".
     */
    static void countIgnored(Context context) {
        SharedPreferences p = prefs(context);
        p.edit().putInt(KEY_IGNORED_EVENTS, p.getInt(KEY_IGNORED_EVENTS, 0) + 1).commit();
    }

    private static File signalFile(Context context) {
        return new File(context.getApplicationContext().getFilesDir(), SIGNAL_FILE);
    }

    private static void append(Context context, JSONObject event) {
        synchronized (FILE_LOCK) {
            File file = signalFile(context);
            try (OutputStreamWriter writer = new OutputStreamWriter(
                    new FileOutputStream(file, true), StandardCharsets.UTF_8)) {
                writer.write(event.toString());
                writer.write("\n");
            } catch (IOException e) {
                Log.e(TAG, "Could not persist car signal", e);
                return;
            }
            compactIfNeeded(context, file);
        }
    }

    /** Caller holds FILE_LOCK. */
    private static void compactIfNeeded(Context context, File file) {
        List<String> lines = readLines(file);
        if (lines.size() <= MAX_SIGNALS + COMPACT_SLACK) return;
        int drop = lines.size() - MAX_SIGNALS;
        List<String> kept = new ArrayList<>(lines.subList(drop, lines.size()));
        if (!writeLines(file, kept)) return;
        SharedPreferences p = prefs(context);
        p.edit().putInt(KEY_DROPPED, p.getInt(KEY_DROPPED, 0) + drop).commit();
        Log.w(TAG, "Car signal buffer full, dropped " + drop + " oldest signals. "
                + "Nothing is draining them.");
    }

    private static List<String> readLines(File file) {
        List<String> lines = new ArrayList<>();
        if (!file.exists()) return lines;
        try (RandomAccessFile reader = new RandomAccessFile(file, "r")) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (!line.isEmpty()) lines.add(line);
            }
        } catch (IOException e) {
            Log.e(TAG, "Could not read car signal buffer", e);
        }
        return lines;
    }

    private static boolean writeLines(File file, List<String> lines) {
        try (OutputStreamWriter writer = new OutputStreamWriter(
                new FileOutputStream(file, false), StandardCharsets.UTF_8)) {
            for (String line : lines) {
                writer.write(line);
                writer.write("\n");
            }
            return true;
        } catch (IOException e) {
            Log.e(TAG, "Could not rewrite car signal buffer", e);
            return false;
        }
    }

    /** Every buffered signal, oldest first. Read only, never consuming. */
    static JSONArray readSignals(Context context) {
        JSONArray out = new JSONArray();
        synchronized (FILE_LOCK) {
            for (String line : readLines(signalFile(context))) {
                try {
                    out.put(new JSONObject(line));
                } catch (JSONException ignored) {
                    // One truncated line must not lose the rest.
                }
            }
        }
        return out;
    }

    static int countSignals(Context context) {
        synchronized (FILE_LOCK) {
            return readLines(signalFile(context)).size();
        }
    }

    /**
     * Drop the oldest {@code count} signals, after the consumer has
     * durably taken them. Read-then-consume rather than a single drain
     * for the same reason as the geofence fix buffer: a consumer that
     * crashes mid-handoff must not silently lose the evidence that a
     * drive started.
     */
    static void consumeSignals(Context context, int count) {
        if (count <= 0) return;
        synchronized (FILE_LOCK) {
            File file = signalFile(context);
            List<String> lines = readLines(file);
            if (lines.isEmpty()) return;
            int drop = Math.min(count, lines.size());
            writeLines(file, new ArrayList<>(lines.subList(drop, lines.size())));
        }
    }

    // ------------------------------------------------------------------
    // Health
    // ------------------------------------------------------------------

    static void recordBluetoothPermission(Context context, String state, boolean asked) {
        SharedPreferences.Editor edit = prefs(context).edit().putString(KEY_BT_PERMISSION, state);
        if (asked) edit.putBoolean(KEY_BT_PERMISSION_ASKED, true);
        edit.commit();
    }

    static boolean bluetoothPermissionAsked(Context context) {
        return prefs(context).getBoolean(KEY_BT_PERMISSION_ASKED, false);
    }

    static void recordProjection(Context context, String type, String error) {
        prefs(context)
                .edit()
                .putString(KEY_PROJECTION_TYPE, type == null ? "unavailable" : type)
                .putBoolean(KEY_PROJECTION_OBSERVED, error == null)
                .putString(KEY_PROJECTION_ERROR, error == null ? "" : error)
                .commit();
    }

    /**
     * The whole picture, failures included.
     *
     * Written to be readable by someone deciding whether this feature is
     * working on a device they cannot hold. Every way it can be off has
     * a field here: permission refused, adapter off, no car ever seen,
     * projection provider absent, signals piling up undrained. A status
     * object that can only say "fine" is how the blackout this project
     * is fixing stayed invisible for a week.
     */
    static JSONObject snapshot(Context context) throws JSONException {
        SharedPreferences p = prefs(context);
        JSONObject out = new JSONObject();
        out.put("schemaVersion", SCHEMA_VERSION);
        out.put("bluetoothPermission",
                p.getString(KEY_BT_PERMISSION, BT_PERMISSION_NOT_REQUESTED));
        out.put("bluetoothPermissionAsked", p.getBoolean(KEY_BT_PERMISSION_ASKED, false));
        out.put("projectionType", p.getString(KEY_PROJECTION_TYPE, "unavailable"));
        out.put("projectionObserved", p.getBoolean(KEY_PROJECTION_OBSERVED, false));
        String projectionError = p.getString(KEY_PROJECTION_ERROR, "");
        out.put("projectionError", projectionError.isEmpty() ? JSONObject.NULL : projectionError);
        out.put("vehicleConnects", p.getInt(KEY_VEHICLE_CONNECTS, 0));
        out.put("vehicleDisconnects", p.getInt(KEY_VEHICLE_DISCONNECTS, 0));
        out.put("otherAudioEvents", p.getInt(KEY_OTHER_AUDIO_EVENTS, 0));
        out.put("ignoredEvents", p.getInt(KEY_IGNORED_EVENTS, 0));
        out.put("pendingSignals", countSignals(context));
        out.put("droppedSignals", p.getInt(KEY_DROPPED, 0));
        out.put("totalSignals", p.getLong(KEY_SEQ, 0));
        String lastWake = p.getString(KEY_LAST_WAKE_OUTCOME, "");
        out.put("lastWakeOutcome", lastWake.isEmpty() ? JSONObject.NULL : lastWake);
        out.put("lastWakeAtMs", p.getLong(KEY_LAST_WAKE_AT, 0));
        String lastSignal = p.getString(KEY_LAST_SIGNAL, "");
        out.put("lastSignal", lastSignal.isEmpty() ? JSONObject.NULL : new JSONObject(lastSignal));
        return out;
    }
}
