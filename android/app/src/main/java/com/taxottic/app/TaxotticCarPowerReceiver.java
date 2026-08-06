package com.taxottic.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.BatteryManager;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Charging state, as a corroborating signal and nothing else.
 *
 * This receiver never starts capture, never stops it, and never wakes
 * anything. That restraint is the entire design and it is deliberate,
 * not an unfinished edge.
 *
 * TripLog ships charging-based detection as "Plug-N-Go", so the idea has
 * been proven to be worth something. What it is worth is corroboration.
 * A phone plugged into a car USB port at the same moment it starts
 * moving at road speed is strong evidence. A phone plugged in at a desk
 * is evidence of a desk. The signal has no discriminating power on its
 * own, so treating it as a wake source would start a location foreground
 * service every time the user charges overnight: real battery cost,
 * real notification noise, and a stream of empty capture sessions. It is
 * emitted with a timestamp so the scoring engine can find it next to a
 * Bluetooth or motion signal, and it is emitted for no other purpose.
 *
 * REGISTERED AT RUNTIME, NOT IN THE MANIFEST. THIS WAS MEASURED.
 *
 * ACTION_POWER_CONNECTED is an implicit broadcast, and unlike the
 * Bluetooth ACL actions it is NOT on Google's exemption list, so Android
 * 8+ does not deliver it to manifest-declared receivers. This was first
 * written as a manifest receiver and tested on an API 36 emulator:
 * `dumpsys battery set ac 1` produced a real system broadcast (SystemUI
 * logged receiving it) and this receiver was not called, with the app
 * process alive AND with it killed. Zero events, both ways.
 *
 * A manifest entry that provably never fires is worse than no entry. It
 * reads as a working feature, it survives review because the code beside
 * it is correct, and it is precisely the failure this codebase has
 * already shipped twice (TaxotticDeviceStatusPlugin compiled to nothing;
 * play-services-location omitted so 25 geofence references never
 * resolved). So the declaration was removed and registration moved to
 * runtime, where implicit broadcasts are still delivered.
 *
 * Nothing is lost by that. This signal is corroboration, it can only
 * corroborate something a live process already noticed, and a live
 * process is exactly the condition under which a runtime receiver works.
 * It is registered from the plugin (Activity alive) and from the capture
 * service (a wake source started us).
 */
public class TaxotticCarPowerReceiver extends BroadcastReceiver {

    private static final String TAG = "TaxotticCarSignals";

    private static final Object LOCK = new Object();

    private static TaxotticCarPowerReceiver registered;

    /**
     * Begin listening, if not already. Safe to call from any thread and
     * any number of times. Never unregistered: it dies with the process,
     * costs one entry in a system table, and an unregister path would
     * only add a way to be accidentally deaf.
     */
    static void register(Context context) {
        synchronized (LOCK) {
            if (registered != null) return;
            Context app = context.getApplicationContext();
            TaxotticCarPowerReceiver receiver = new TaxotticCarPowerReceiver();
            IntentFilter filter = new IntentFilter();
            filter.addAction(Intent.ACTION_POWER_CONNECTED);
            filter.addAction(Intent.ACTION_POWER_DISCONNECTED);
            try {
                ContextCompat.registerReceiver(
                        app, receiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED);
                registered = receiver;
            } catch (Exception e) {
                Log.w(TAG, "Could not register for charging state", e);
            }
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || context == null) return;
        String action = intent.getAction();
        boolean connected = Intent.ACTION_POWER_CONNECTED.equals(action);
        boolean disconnected = Intent.ACTION_POWER_DISCONNECTED.equals(action);
        if (!connected && !disconnected) return;

        Context app = context.getApplicationContext();
        try {
            JSONObject event = TaxotticCarSignalStore.newEvent(
                    app,
                    TaxotticCarSignalStore.KIND_POWER,
                    connected
                            ? TaxotticCarSignalStore.STATE_CONNECTED
                            : TaxotticCarSignalStore.STATE_DISCONNECTED);
            event.put("plugged", pluggedType(app));
            event.put("wakeAttempted", false);
            event.put("wakeOutcome", TaxotticCarSignalStore.WAKE_NOT_A_WAKE_SOURCE);
            event.put("wakeDetail", "corroborating_only");
            TaxotticCarSignalStore.record(app, event);
        } catch (JSONException e) {
            Log.e(TAG, "Could not build power signal event", e);
        }
    }

    /**
     * Which kind of charger, read from the sticky battery broadcast.
     *
     * The plug type is what makes this signal worth recording at all: a
     * wireless pad is a nightstand, AC is usually a wall socket, and USB
     * is the one that is plausibly a car. The distinction is handed to
     * the scoring engine rather than judged here.
     *
     * ACTION_POWER_CONNECTED itself does not carry EXTRA_PLUGGED, so the
     * value comes from the retained ACTION_BATTERY_CHANGED intent, which
     * is a read of already-published state and not a registration.
     */
    private static String pluggedType(Context context) {
        Intent battery = null;
        try {
            IntentFilter filter = new IntentFilter(Intent.ACTION_BATTERY_CHANGED);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                battery = context.registerReceiver(null, filter, Context.RECEIVER_NOT_EXPORTED);
            } else {
                battery = context.registerReceiver(null, filter);
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not read battery state for plug type", e);
        }
        if (battery == null) return "unknown";
        int plugged = battery.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1);
        switch (plugged) {
            case 0: return "none";
            case BatteryManager.BATTERY_PLUGGED_AC: return "ac";
            case BatteryManager.BATTERY_PLUGGED_USB: return "usb";
            case BatteryManager.BATTERY_PLUGGED_WIRELESS: return "wireless";
            default:
                // BATTERY_PLUGGED_DOCK is API 33+, so it is compared
                // numerically rather than by constant to keep this
                // readable on every supported level.
                if (plugged == 8) return "dock";
                return plugged < 0 ? "unknown" : "other";
        }
    }
}
