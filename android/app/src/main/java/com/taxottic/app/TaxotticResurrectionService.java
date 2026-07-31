package com.taxottic.app;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.content.ContextCompat;

/**
 * The foreground service that a learned-place geofence exit starts when
 * the app process has been dead all night.
 *
 * PLAY POLICY, READ BEFORE CHANGING THE SERVICE TYPE OR REMOVING THIS.
 *
 * Google announced in April 2026 that "geofencing" is no longer an
 * approved use case for a location foreground service, and directs
 * developers to the Geofence API instead. That is exactly the shape
 * built here, and the distinction matters:
 *
 *   - We do NOT run a foreground service in order to do geofencing.
 *     Geofencing is done by the platform Geofence API
 *     (GeofencingClient), which needs no service of ours at all. See
 *     TaxotticGeofencePlugin and TaxotticGeofenceReceiver.
 *   - The geofence exit is only the TRIGGER. What this service then
 *     does is "vehicle activity tracking", which IS an explicitly named
 *     approved location foreground-service use case in Play's
 *     requirements effective 26 August 2026.
 *
 * If anyone ever "simplifies" this by monitoring regions from inside
 * the service, or relabels the service as a geofencing service, the app
 * becomes non-compliant. Do not.
 *
 * ANDROID BACKGROUND-START, ALSO NOT OPTIONAL READING.
 *
 * A geofencing transition event is a documented exemption from the
 * Android 12+ restriction on starting a foreground service from the
 * background. That exemption lets us START. It grants no location
 * access whatsoever. Location while backgrounded needs
 * ACCESS_BACKGROUND_LOCATION genuinely granted, and the receiver
 * refuses to start this service without it.
 *
 * And "granted" is still not "usable": PermissionChecker reports a
 * while-in-use grant as granted even when the app is backgrounded and
 * therefore cannot see location. The only proof that location is
 * actually flowing is a fix arriving. So this service starts in a
 * WAITING state, promotes itself to CAPTURING on the first fix, and
 * demotes itself to BLIND if no fix arrives inside
 * BLIND_TIMEOUT_MS. Blind is written to durable health state and shown
 * in the notification text. It is never reported as success.
 */
public class TaxotticResurrectionService extends Service {

    private static final String TAG = "TaxotticGeofence";

    static final String EXTRA_PLACE_ID = "placeId";
    static final String ACTION_STOP = "com.taxottic.app.RESURRECTION_STOP";

    /**
     * Distinct from the @capgo plugin's 28351. Two location foreground
     * services must never share a notification id, or one silently
     * replaces the other's notification and the user sees a status that
     * belongs to a service that is not running.
     */
    private static final int NOTIFICATION_ID = 28352;

    private static final String CHANNEL_ID = "com.taxottic.app.resurrection";

    /**
     * If no fix has arrived in three minutes we are blind. A cold GPS
     * start in a driveway is typically 15 to 60 seconds, so three
     * minutes is generous enough not to false-positive, short enough
     * that the user learns about it during the drive rather than after.
     */
    private static final long BLIND_TIMEOUT_MS = 3 * 60 * 1000L;

    /**
     * Give up entirely if still blind after fifteen minutes. Holding a
     * wake lock and a foreground service that provably cannot see
     * location is pure battery cost with no benefit, and the health
     * state has already recorded why.
     */
    private static final long BLIND_GIVE_UP_MS = 15 * 60 * 1000L;

    /**
     * Stop capturing after six minutes without meaningful movement.
     * Matches the existing stationary drive-end fallback in
     * lib/mileage/drive-end.ts so a resurrection-captured drive and a
     * normally captured drive close on the same rule.
     */
    private static final long STATIONARY_STOP_MS = 6 * 60 * 1000L;
    private static final float STATIONARY_RADIUS_M = 60f;

    /** Hard ceiling on one resurrection session. */
    private static final long MAX_SESSION_MS = 4 * 60 * 60 * 1000L;

    private static final long MIN_INTERVAL_MS = 1000L;
    private static final float MIN_DISTANCE_M = 0f;

    private final Handler handler = new Handler(Looper.getMainLooper());

    private LocationManager locationManager;
    private LocationListener listener;
    private PowerManager.WakeLock wakeLock;

    private String placeId;
    private long startedAtMs;
    private int fixCount;
    private boolean blind;
    private Location stationaryAnchor;
    private long stationarySinceMs;
    private String finalState;
    private String finalDetail;

    private final Runnable blindCheck = this::onBlindTimeout;
    private final Runnable giveUp = () -> stopWithState(TaxotticGeofenceStore.CAPTURE_BLIND,
            "no_fix_after_give_up");
    private final Runnable sessionCap = () -> stopWithState(TaxotticGeofenceStore.CAPTURE_ENDED,
            "session_cap");

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            // The WebView tracker has taken over. Hand off cleanly
            // rather than running two location services at once.
            stopWithState(TaxotticGeofenceStore.CAPTURE_ENDED, "handoff_to_watcher");
            return START_NOT_STICKY;
        }

        if (listener != null) {
            // Already capturing. A second exit while a session is live
            // is not a reason to restart the GPS stream.
            return START_STICKY;
        }

        placeId = intent == null ? null : intent.getStringExtra(EXTRA_PLACE_ID);
        startedAtMs = System.currentTimeMillis();
        fixCount = 0;
        blind = false;

        if (!promoteToForeground(NotificationState.WAITING)) {
            // Could not become a foreground service. Recorded, not
            // swallowed, then we stop rather than lingering as a
            // background service the OS will kill anyway.
            TaxotticGeofenceStore.recordCapture(this, TaxotticGeofenceStore.CAPTURE_ENDED,
                    "foreground_promotion_failed", 0, startedAtMs, false);
            stopSelf();
            return START_NOT_STICKY;
        }

        TaxotticGeofenceStore.recordCapture(this, TaxotticGeofenceStore.CAPTURE_BLIND,
                "awaiting_first_fix", 0, startedAtMs, true);

        if (!startLocationUpdates()) {
            stopWithState(TaxotticGeofenceStore.CAPTURE_PROVIDER_OFF, "gps_provider_unavailable");
            return START_NOT_STICKY;
        }

        acquireWakeLock();
        handler.postDelayed(blindCheck, BLIND_TIMEOUT_MS);
        handler.postDelayed(giveUp, BLIND_GIVE_UP_MS);
        handler.postDelayed(sessionCap, MAX_SESSION_MS);
        return START_STICKY;
    }

    // -----------------------------------------------------------------
    // Location
    // -----------------------------------------------------------------

    private boolean startLocationUpdates() {
        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) return false;

        boolean fine = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
                == PackageManager.PERMISSION_GRANTED;
        if (!fine) return false;

        listener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                onFix(location);
            }

            // Required on API levels below 30 or the listener is never
            // registered on some OEM builds.
            @Override
            public void onStatusChanged(String provider, int status, android.os.Bundle extras) {}

            @Override
            public void onProviderEnabled(String provider) {}

            @Override
            public void onProviderDisabled(String provider) {
                stopWithState(TaxotticGeofenceStore.CAPTURE_PROVIDER_OFF, "gps_disabled_mid_session");
            }
        };

        try {
            if (!locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                return false;
            }
            locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, MIN_INTERVAL_MS, MIN_DISTANCE_M, listener);
        } catch (SecurityException | IllegalArgumentException e) {
            Log.e(TAG, "Could not request resurrection location updates", e);
            listener = null;
            return false;
        }
        return true;
    }

    private void onFix(Location location) {
        if (fixCount == 0) {
            // First fix. This, and only this, proves the permission is
            // usable rather than merely present.
            handler.removeCallbacks(blindCheck);
            handler.removeCallbacks(giveUp);
            blind = false;
            updateNotification(NotificationState.CAPTURING);
        }
        boolean written = TaxotticGeofenceStore.appendFix(this, location, placeId);
        fixCount++;
        if (!written) {
            updateNotification(NotificationState.BUFFER_FULL);
            TaxotticGeofenceStore.recordCapture(this, TaxotticGeofenceStore.CAPTURE_FIXES,
                    "buffer_full", fixCount, startedAtMs, true);
        } else if (fixCount % 30 == 1) {
            // Checkpoint the health state periodically rather than on
            // every fix, so a process kill loses at most 30 seconds of
            // status but disk writes stay cheap.
            TaxotticGeofenceStore.recordCapture(this, TaxotticGeofenceStore.CAPTURE_FIXES,
                    "", fixCount, startedAtMs, true);
        }
        trackStationary(location);
    }

    private void trackStationary(Location location) {
        long now = System.currentTimeMillis();
        if (stationaryAnchor == null || stationaryAnchor.distanceTo(location) > STATIONARY_RADIUS_M) {
            stationaryAnchor = new Location(location);
            stationarySinceMs = now;
            return;
        }
        if (now - stationarySinceMs >= STATIONARY_STOP_MS) {
            stopWithState(TaxotticGeofenceStore.CAPTURE_ENDED, "stationary");
        }
    }

    private void onBlindTimeout() {
        blind = true;
        updateNotification(NotificationState.BLIND);
        TaxotticGeofenceStore.recordCapture(this, TaxotticGeofenceStore.CAPTURE_BLIND,
                "no_fix_within_timeout", fixCount, startedAtMs, true);
        Log.w(TAG, "Resurrection service started but received no location fix. "
                + "Location permission is present but not usable in the background.");
    }

    private void stopWithState(String state, String detail) {
        // Remembered so onDestroy reports the real reason instead of
        // flattening every exit to "destroyed".
        finalState = state;
        finalDetail = detail;
        TaxotticGeofenceStore.recordCapture(this, state, detail, fixCount, startedAtMs, false);
        stopSelf();
    }

    // -----------------------------------------------------------------
    // Notification
    // -----------------------------------------------------------------

    private enum NotificationState { WAITING, CAPTURING, BLIND, BUFFER_FULL }

    private boolean promoteToForeground(NotificationState state) {
        ensureChannel();
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, buildNotification(state),
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            } else {
                startForeground(NOTIFICATION_ID, buildNotification(state));
            }
            return true;
        } catch (Exception e) {
            // Includes ForegroundServiceStartNotAllowedException on
            // API 31+ and SecurityException on API 34+ when the typed
            // permission is missing.
            Log.e(TAG, "Could not promote resurrection service to foreground", e);
            return false;
        }
    }

    private void updateNotification(NotificationState state) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        try {
            manager.notify(NOTIFICATION_ID, buildNotification(state));
        } catch (Exception e) {
            Log.e(TAG, "Could not update resurrection notification", e);
        }
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Automatic drive capture", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shown while Taxottic is recording a drive it started automatically.");
        manager.createNotificationChannel(channel);
    }

    /**
     * The notification is the only thing the driver sees, so it states
     * the real state. The previous failure went unnoticed for a week
     * partly because a notification said tracking was healthy while
     * every fix was being discarded. A notification that can only say
     * "fine" is worse than no notification.
     */
    private Notification buildNotification(NotificationState state) {
        String title;
        String text;
        switch (state) {
            case CAPTURING:
                title = "Recording your drive";
                text = "Started automatically when you left a saved place.";
                break;
            case BLIND:
                title = "Cannot record this drive";
                text = "No location received. Set Location to \"Allow all the time\". Tap to fix.";
                break;
            case BUFFER_FULL:
                title = "Drive recording paused";
                text = "Storage for unsent points is full. Open Taxottic to upload them.";
                break;
            case WAITING:
            default:
                title = "Starting drive recording";
                text = "Waiting for a GPS signal.";
                break;
        }

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);

        builder.setContentTitle(title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setOngoing(true)
                .setWhen(System.currentTimeMillis())
                .setSmallIcon(getResources().getIdentifier("ic_stat_taxottic", "drawable", getPackageName()));

        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            launch.addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
            builder.setContentIntent(PendingIntent.getActivity(this, 0, launch,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
        }
        return builder.build();
    }

    // -----------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm == null) return;
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Taxottic::ResurrectionCapture");
            wakeLock.acquire(MAX_SESSION_MS);
        } catch (Exception e) {
            Log.e(TAG, "Could not acquire resurrection wake lock", e);
        }
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(blindCheck);
        handler.removeCallbacks(giveUp);
        handler.removeCallbacks(sessionCap);
        if (locationManager != null && listener != null) {
            try {
                locationManager.removeUpdates(listener);
            } catch (Exception e) {
                Log.e(TAG, "Could not remove resurrection location updates", e);
            }
        }
        listener = null;
        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
            } catch (Exception ignored) {
                // Releasing an already-released lock is not worth a crash.
            }
        }
        wakeLock = null;
        // Whatever path we exited by, the durable state must not be
        // left saying "capturing". An OS kill sets no final state, so
        // that case is named rather than reported as a clean end.
        String state = finalState;
        String detail = finalDetail;
        if (state == null) {
            state = blind ? TaxotticGeofenceStore.CAPTURE_BLIND : TaxotticGeofenceStore.CAPTURE_ENDED;
            detail = blind ? "destroyed_while_blind" : "destroyed_without_stop";
        }
        TaxotticGeofenceStore.recordCapture(this, state, detail, fixCount, startedAtMs, false);
        super.onDestroy();
    }
}
