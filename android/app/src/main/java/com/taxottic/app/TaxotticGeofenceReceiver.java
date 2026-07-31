package com.taxottic.app;

import android.Manifest;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofenceStatusCodes;
import com.google.android.gms.location.GeofencingEvent;

import java.util.List;

/**
 * Where the resurrection actually happens.
 *
 * This is a manifest-declared receiver, which is the whole point: the
 * platform cold-starts our process to deliver a geofence transition
 * even when the app has been dead for hours. Nothing of ours has to be
 * running, no alarm has to survive, and Samsung's sleeping-apps policy
 * (which restricts Job, Alarm and Foreground-service) does not gate the
 * delivery of a Geofence API callback.
 *
 * Deliberately NOT built on the @capgo plugin's geofence API. That
 * plugin does ship a working geofence path, and its delivery is genuinely
 * more durable than its GPS path, but what its receiver does on a
 * transition is send a LocalBroadcast (in-process, so a no-op when the
 * process was just started for this broadcast and nothing has
 * registered) and enqueue a WorkManager HTTP POST. Neither restarts
 * tracking, and its PendingIntent targets its own receiver class so we
 * cannot join it. We own the registration and therefore the
 * PendingIntent, so the exit lands here, where we can act on it.
 */
public class TaxotticGeofenceReceiver extends BroadcastReceiver {

    private static final String TAG = "TaxotticGeofence";

    private static final int PENDING_INTENT_REQUEST_CODE = 71204;

    @Override
    public void onReceive(Context context, Intent intent) {
        GeofencingEvent event = GeofencingEvent.fromIntent(intent);
        if (event == null) return;

        if (event.hasError()) {
            int code = event.getErrorCode();
            String message = GeofenceStatusCodes.getStatusCodeString(code);
            Log.e(TAG, "Geofence event error " + code + ": " + message);
            TaxotticGeofenceStore.recordTransition(context, null, false,
                    TaxotticGeofenceStore.OUTCOME_SERVICE_START_DENIED, "geofence_error_" + code);
            if (code == GeofenceStatusCodes.GEOFENCE_NOT_AVAILABLE) {
                // Location services were turned off, which unregisters
                // every geofence. Say so instead of continuing to
                // report the mesh as armed.
                TaxotticGeofenceStore.recordRegistration(context,
                        TaxotticGeofenceStore.ARM_REGISTRATION_FAILED, 0, "geofence_not_available");
            }
            return;
        }

        int transition = event.getGeofenceTransition();
        List<Geofence> triggering = event.getTriggeringGeofences();
        String placeId = null;
        if (triggering != null && !triggering.isEmpty()) {
            placeId = triggering.get(0).getRequestId();
        }

        if (transition != Geofence.GEOFENCE_TRANSITION_EXIT) {
            // Entries are recorded as a stop hint only. Arriving
            // somewhere is not a reason to start a drive.
            TaxotticGeofenceStore.recordTransition(context, placeId, true,
                    TaxotticGeofenceStore.OUTCOME_ENTER_IGNORED, null);
            return;
        }

        if (TaxotticGeofenceStore.isCaptureRunning(context)) {
            TaxotticGeofenceStore.recordTransition(context, placeId, false,
                    TaxotticGeofenceStore.OUTCOME_STARTED, "already_running");
            return;
        }

        // A geofencing transition exempts us from the Android 12+ ban on
        // background foreground-service starts. It does NOT grant
        // location access. Starting a location service without
        // background location produces a service that runs, shows a
        // notification, and sees nothing: precisely the silent failure
        // this whole change exists to eliminate. So we refuse.
        if (!hasBackgroundLocation(context)) {
            TaxotticGeofenceStore.recordTransition(context, placeId, false,
                    TaxotticGeofenceStore.OUTCOME_NO_BACKGROUND_PERMISSION,
                    "ACCESS_BACKGROUND_LOCATION not granted");
            Log.w(TAG, "Geofence exit ignored: ACCESS_BACKGROUND_LOCATION is not granted, "
                    + "a location foreground service started now would be blind.");
            return;
        }

        Intent serviceIntent = new Intent(context, TaxotticResurrectionService.class);
        serviceIntent.putExtra(TaxotticResurrectionService.EXTRA_PLACE_ID, placeId);
        try {
            ContextCompat.startForegroundService(context, serviceIntent);
            TaxotticGeofenceStore.recordTransition(context, placeId, false,
                    TaxotticGeofenceStore.OUTCOME_STARTED, null);
        } catch (Exception e) {
            // ForegroundServiceStartNotAllowedException on API 31+ if
            // the exemption did not apply. Recorded, never swallowed.
            Log.e(TAG, "Could not start resurrection service from geofence exit", e);
            TaxotticGeofenceStore.recordTransition(context, placeId, false,
                    TaxotticGeofenceStore.OUTCOME_SERVICE_START_DENIED, e.getClass().getSimpleName());
        }
    }

    static boolean hasBackgroundLocation(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            // Before API 29 there is no separate background permission;
            // fine location is background location.
            return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
                    == PackageManager.PERMISSION_GRANTED;
        }
        return ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * One PendingIntent for the whole mesh. It must be stable across
     * process deaths and app updates, so the request code is a constant
     * and the intent carries no extras (extras are not part of
     * PendingIntent equality and would be silently dropped).
     */
    static PendingIntent pendingIntent(Context context) {
        Intent intent = new Intent(context, TaxotticGeofenceReceiver.class);
        intent.setPackage(context.getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // Play services writes the transition into this intent, so
            // it has to be mutable.
            flags |= PendingIntent.FLAG_MUTABLE;
        }
        return PendingIntent.getBroadcast(
                context.getApplicationContext(), PENDING_INTENT_REQUEST_CODE, intent, flags);
    }
}
