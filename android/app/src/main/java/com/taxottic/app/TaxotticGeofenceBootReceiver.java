package com.taxottic.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Re-arms the learned-place mesh after the two events that silently
 * throw every registered geofence away.
 *
 * ACTION_BOOT_COMPLETED: geofences do not survive a reboot. Without
 * this, a phone that restarts overnight wakes up with no mesh and the
 * morning drive is missed exactly as before.
 *
 * ACTION_MY_PACKAGE_REPLACED: an app update also drops them, and the
 * user has no reason to open the app after an automatic Play update.
 * This is the case most likely to be forgotten, because it only bites
 * on the release after the one you tested.
 *
 * Note that ACTION_MY_PACKAGE_REPLACED is delivered only to the app
 * being replaced, needs no permission, and is not affected by the
 * background broadcast restrictions that apply to implicit broadcasts.
 * BOOT_COMPLETED needs RECEIVE_BOOT_COMPLETED, declared in the app
 * manifest.
 *
 * Both paths refuse to arm when ACCESS_BACKGROUND_LOCATION is missing,
 * and record that refusal, rather than registering a mesh that could
 * only ever fire while the app is already open.
 */
public class TaxotticGeofenceBootReceiver extends BroadcastReceiver {

    private static final String TAG = "TaxotticGeofence";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            return;
        }
        if (TaxotticGeofenceStore.getPlaces(context).isEmpty()) {
            // Nothing learned yet. Registration would be a no-op and
            // the arm state already says so.
            return;
        }
        String state = TaxotticGeofenceRegistrar.reregister(context);
        Log.i(TAG, "Re-armed learned-place geofences after " + action + ": " + state);
    }
}
