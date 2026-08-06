package com.taxottic.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import androidx.car.app.connection.CarConnection;
import androidx.lifecycle.Observer;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Android Auto / projection presence, via androidx.car.app's
 * CarConnection.
 *
 * When the phone is projecting to a head unit the user is, to as near
 * certainty as this platform offers, in a vehicle. Nothing else in the
 * signal set is that unambiguous: a Bluetooth car-audio connect can be a
 * passenger, a geofence exit can be a walk, road-speed movement can be a
 * bus. Projection means a car handshake completed.
 *
 * IT IS NOT A WAKE SOURCE, AND CANNOT BE MADE ONE.
 *
 * CarConnection reads a ContentProvider published by the Android Auto
 * host and watches it with a ContentObserver. Both live in our process.
 * A ContentObserver in a process that does not exist observes nothing,
 * and there is no PendingIntent or manifest broadcast to register in its
 * place. So projection can confirm a drive we already noticed, and can
 * never be the thing that notices. That is the Tier 1 / Tier 2 split in
 * docs/mileage-detection-architecture.md section 3, and getting it
 * backwards is how a design that reads well never fires.
 *
 * It is therefore started from the two places our process is known to be
 * alive: the Activity, and the capture service that a Bluetooth connect
 * or geofence exit started. Started, never stopped. One ContentObserver
 * costs nothing measurable, it dies with the process, and a stop() would
 * only add a way to be accidentally deaf.
 */
final class TaxotticCarProjectionMonitor {

    private static final String TAG = "TaxotticCarSignals";

    private static final Object LOCK = new Object();

    private static boolean observing;

    /** Last value seen, so we only emit on change and not on re-delivery. */
    private static int lastType = Integer.MIN_VALUE;

    private TaxotticCarProjectionMonitor() {}

    /**
     * Begin watching, if not already. Safe to call from any thread and
     * any number of times.
     */
    static void start(Context context) {
        synchronized (LOCK) {
            if (observing) return;
            observing = true;
        }
        Context app = context.getApplicationContext();
        // LiveData.observeForever is main-thread only and throws
        // otherwise. Both callers may be on a binder thread.
        new Handler(Looper.getMainLooper()).post(() -> attach(app));
    }

    private static void attach(Context app) {
        try {
            Observer<Integer> observer = type -> onType(app, type);
            new CarConnection(app).getType().observeForever(observer);
            TaxotticCarSignalStore.recordProjection(app, "unknown", null);
        } catch (Throwable t) {
            // The car host provider may be absent, restricted by package
            // visibility, or throw on an OEM build. A missing Android
            // Auto host is the common case and is not a fault, but it
            // must still be visible rather than looking like "no car has
            // ever been connected".
            synchronized (LOCK) {
                observing = false;
            }
            Log.w(TAG, "Car projection state is unavailable on this device", t);
            TaxotticCarSignalStore.recordProjection(
                    app, "unavailable", t.getClass().getSimpleName());
        }
    }

    private static void onType(Context app, Integer type) {
        if (type == null) return;
        synchronized (LOCK) {
            if (type == lastType) return;
            lastType = type;
        }
        String name = typeName(type);
        boolean connected = type == CarConnection.CONNECTION_TYPE_PROJECTION
                || type == CarConnection.CONNECTION_TYPE_NATIVE;
        TaxotticCarSignalStore.recordProjection(app, name, null);
        try {
            JSONObject event = TaxotticCarSignalStore.newEvent(
                    app,
                    TaxotticCarSignalStore.KIND_PROJECTION,
                    connected
                            ? TaxotticCarSignalStore.STATE_CONNECTED
                            : TaxotticCarSignalStore.STATE_DISCONNECTED);
            event.put("projectionType", name);
            event.put("wakeAttempted", false);
            event.put("wakeOutcome", TaxotticCarSignalStore.WAKE_NOT_A_WAKE_SOURCE);
            event.put("wakeDetail", "confirmation_only");
            TaxotticCarSignalStore.record(app, event);
        } catch (JSONException e) {
            Log.e(TAG, "Could not build projection signal event", e);
        }
    }

    private static String typeName(int type) {
        if (type == CarConnection.CONNECTION_TYPE_PROJECTION) return "projection";
        if (type == CarConnection.CONNECTION_TYPE_NATIVE) return "native";
        if (type == CarConnection.CONNECTION_TYPE_NOT_CONNECTED) return "none";
        return "unknown";
    }
}
