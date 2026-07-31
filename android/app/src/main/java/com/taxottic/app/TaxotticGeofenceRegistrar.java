package com.taxottic.app;

import android.content.Context;
import android.util.Log;

import com.google.android.gms.location.Geofence;
import com.google.android.gms.location.GeofencingClient;
import com.google.android.gms.location.GeofencingRequest;
import com.google.android.gms.location.LocationServices;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/**
 * Registration of the learned-place mesh with the platform Geofence
 * API. Kept free of any Capacitor dependency so the boot receiver can
 * use it without the bridge existing.
 *
 * Registration is idempotent: we always remove the whole mesh by
 * PendingIntent first, then add the current place list. Partial
 * reconciliation is not worth the bug surface for at most eight
 * regions.
 */
final class TaxotticGeofenceRegistrar {

    private static final String TAG = "TaxotticGeofence";

    private TaxotticGeofenceRegistrar() {}

    /**
     * (Re)register every stored place. Safe to call from a receiver:
     * the Play services calls are asynchronous and the durable health
     * state is written from their callbacks, so a receiver that has
     * already returned still gets its result recorded.
     *
     * @return the arm state that was recorded synchronously, which is a
     *         refusal reason when we did not even attempt registration.
     */
    static String reregister(Context context) {
        Context app = context.getApplicationContext();
        List<JSONObject> places = TaxotticGeofenceStore.getPlaces(app);

        if (!TaxotticGeofenceReceiver.hasBackgroundLocation(app)) {
            // Registering without background location produces a mesh
            // that fires only while the app is already open, which is
            // exactly the case that never needed resurrecting. Refuse
            // and say why.
            TaxotticGeofenceStore.recordRegistration(app,
                    TaxotticGeofenceStore.ARM_NO_BACKGROUND_PERMISSION, 0,
                    "ACCESS_BACKGROUND_LOCATION not granted");
            return TaxotticGeofenceStore.ARM_NO_BACKGROUND_PERMISSION;
        }

        GeofencingClient client = LocationServices.getGeofencingClient(app);

        if (places.isEmpty()) {
            try {
                client.removeGeofences(TaxotticGeofenceReceiver.pendingIntent(app));
            } catch (Exception e) {
                Log.e(TAG, "Could not clear geofences", e);
            }
            TaxotticGeofenceStore.recordRegistration(app,
                    TaxotticGeofenceStore.ARM_NO_PLACES, 0, null);
            return TaxotticGeofenceStore.ARM_NO_PLACES;
        }

        List<Geofence> fences = new ArrayList<>();
        for (JSONObject place : places) {
            fences.add(
                    new Geofence.Builder()
                            .setRequestId(place.optString("id"))
                            .setCircularRegion(
                                    place.optDouble("latitude"),
                                    place.optDouble("longitude"),
                                    (float) place.optDouble("radius", 150))
                            .setTransitionTypes(
                                    Geofence.GEOFENCE_TRANSITION_ENTER | Geofence.GEOFENCE_TRANSITION_EXIT)
                            .setExpirationDuration(Geofence.NEVER_EXPIRE)
                            // The phone has been parked at home for
                            // hours before the drive that matters, so
                            // an exit must fire immediately rather than
                            // waiting out a dwell.
                            .setLoiteringDelay(0)
                            .setNotificationResponsiveness(0)
                            .build());
        }

        GeofencingRequest request = new GeofencingRequest.Builder()
                // INITIAL_TRIGGER_DWELL is unavailable for our
                // transition types; ENTER means that registering while
                // already inside home immediately confirms the phone is
                // home, which is the state we want before an exit.
                .setInitialTrigger(GeofencingRequest.INITIAL_TRIGGER_ENTER)
                .addGeofences(fences)
                .build();

        final int count = fences.size();
        try {
            client
                    .removeGeofences(TaxotticGeofenceReceiver.pendingIntent(app))
                    .addOnCompleteListener(ignored -> addGeofences(app, client, request, count));
        } catch (Exception e) {
            Log.e(TAG, "Could not remove existing geofences", e);
            addGeofences(app, client, request, count);
        }

        // Optimistic, corrected by the callbacks below. Recorded now so
        // a process death between here and the callback does not leave
        // the state saying the mesh is armed with the old count.
        TaxotticGeofenceStore.recordRegistration(app,
                TaxotticGeofenceStore.ARM_REGISTRATION_FAILED, 0, "registration_in_flight");
        return TaxotticGeofenceStore.ARM_ARMED;
    }

    private static void addGeofences(
            Context app, GeofencingClient client, GeofencingRequest request, int count) {
        try {
            client
                    .addGeofences(request, TaxotticGeofenceReceiver.pendingIntent(app))
                    .addOnSuccessListener(ignored ->
                            TaxotticGeofenceStore.recordRegistration(
                                    app, TaxotticGeofenceStore.ARM_ARMED, count, null))
                    .addOnFailureListener(e -> {
                        Log.e(TAG, "Geofence registration failed", e);
                        TaxotticGeofenceStore.recordRegistration(
                                app, TaxotticGeofenceStore.ARM_REGISTRATION_FAILED, 0,
                                e.getClass().getSimpleName() + ": " + e.getMessage());
                    });
        } catch (SecurityException e) {
            Log.e(TAG, "Geofence registration denied", e);
            TaxotticGeofenceStore.recordRegistration(
                    app, TaxotticGeofenceStore.ARM_NO_BACKGROUND_PERMISSION, 0, "SecurityException");
        } catch (Exception e) {
            Log.e(TAG, "Geofence registration threw", e);
            TaxotticGeofenceStore.recordRegistration(
                    app, TaxotticGeofenceStore.ARM_REGISTRATION_FAILED, 0, e.getClass().getSimpleName());
        }
    }
}
