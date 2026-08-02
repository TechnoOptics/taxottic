package com.taxottic.app;

import android.Manifest;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * The car-connection wake source.
 *
 * Microsoft's MileIQ team published that a Bluetooth connection event
 * beats both location and motion as a trip-start signal, and on Android
 * (unlike iOS, where classic car audio is invisible to CoreBluetooth)
 * the platform will genuinely start a dead process to deliver it. That
 * makes this the one signal on this platform that is both the earliest
 * available and capable of waking us.
 *
 * WHY THIS EXISTS ALONGSIDE THE GEOFENCE MESH, NOT INSTEAD OF IT.
 *
 * They fail in different places, which is the whole argument for having
 * both. A geofence exit needs the car to physically leave a learned
 * radius, so it fires a minute or two into the drive and only near a
 * place we have already learned. A Bluetooth connect fires before the
 * car has moved at all and works at an address we have never seen. In
 * the other direction, the mesh covers every driver whose car has no
 * Bluetooth, who declines the permission, or who keeps the phone radio
 * off. Neither is a superset of the other. Two independent wake sources
 * that repair the same net is the design (see
 * docs/mileage-detection-architecture.md section 4.1), not redundancy to
 * be tidied away later.
 *
 * DELIVERY, AND WHAT IS AND IS NOT PROVEN.
 *
 * Android 8 blocks most implicit broadcasts from manifest-declared
 * receivers. ACTION_ACL_CONNECTED and ACTION_ACL_DISCONNECTED are on
 * Google's published exemption list, so a manifest receiver is the right
 * shape. `[verified-doc]`. What is NOT proven in this checkout is
 * delivery to a process that has been dead for hours on a real handset
 * with a real car, because an emulator has no car radio. The code is
 * written so that an unproven assumption fails loudly: every path that
 * declines to start capture writes a named outcome to durable state, so
 * a device that never wakes says why instead of looking idle.
 *
 * PERMISSION, AND WHAT HAPPENS WITHOUT IT.
 *
 * On API 31+ these broadcasts are sent with BLUETOOTH_CONNECT as a
 * required permission, so without the runtime grant we are not merely
 * unable to read the device details, we are not delivered the broadcast
 * at all. There is no callback for "you were skipped". That is exactly
 * the class of silent disablement this project keeps getting burned by,
 * so the permission state is written into health state
 * (TaxotticCarSignalStore.snapshot) and surfaced to the driver, and the
 * app is otherwise unchanged: the geofence mesh, the foreground service
 * and every existing capture path behave identically whether the
 * permission is granted or refused.
 */
public class TaxotticCarBluetoothReceiver extends BroadcastReceiver {

    private static final String TAG = "TaxotticCarSignals";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || context == null) return;
        String action = intent.getAction();
        boolean connected = BluetoothDevice.ACTION_ACL_CONNECTED.equals(action);
        boolean disconnected = BluetoothDevice.ACTION_ACL_DISCONNECTED.equals(action);
        if (!connected && !disconnected) return;

        Context app = context.getApplicationContext();
        BluetoothDevice device = deviceFrom(intent);
        BluetoothClass btClass = classFrom(intent, device);

        int majorRaw = btClass == null ? -1 : btClass.getMajorDeviceClass();
        int deviceRaw = btClass == null ? -1 : btClass.getDeviceClass();

        // Filter to vehicles before writing anything.
        //
        // Every headset, watch, keyboard and fitness band the user owns
        // fires these same broadcasts. Logging all of them would build a
        // record of which peripherals someone owns and when they wear
        // them, which is not ours to keep and is useless downstream. The
        // audio-video major class is the widest net worth casting: it
        // holds car audio and handsfree units, and also headphones and
        // speakers, which is why the vehicle decision below is narrower
        // than the log decision here.
        if (majorRaw != BluetoothClass.Device.Major.AUDIO_VIDEO) {
            TaxotticCarSignalStore.countIgnored(app);
            return;
        }

        boolean vehicle = isVehicleClass(deviceRaw);

        try {
            JSONObject event = TaxotticCarSignalStore.newEvent(
                    app,
                    TaxotticCarSignalStore.KIND_BLUETOOTH,
                    connected
                            ? TaxotticCarSignalStore.STATE_CONNECTED
                            : TaxotticCarSignalStore.STATE_DISCONNECTED);
            event.put("deviceId", orNull(TaxotticCarSignalStore.deviceIdFor(app, addressOf(device))));
            event.put("deviceName", orNull(nameOf(app, device)));
            event.put("deviceMajorClass", majorClassName(majorRaw));
            event.put("deviceClass", deviceClassName(deviceRaw));
            event.put("deviceMajorClassRaw", majorRaw);
            event.put("deviceClassRaw", deviceRaw);
            event.put("vehicleClass", vehicle);

            if (connected && vehicle) {
                applyWake(app, event);
            } else if (connected) {
                // Audio, but not a car. Recorded for the scorer, which
                // may learn that a particular driver's vehicle reports
                // itself as a hi-fi unit, and never woken on.
                event.put("wakeAttempted", false);
                event.put("wakeOutcome", TaxotticCarSignalStore.WAKE_NOT_VEHICLE_CLASS);
            } else {
                // A disconnect is a trip-END hint and is worth as much
                // as the start, because bad stop detection is what
                // splits one journey into three. It is emitted and
                // nothing more: this receiver does not stop capture. The
                // car's radio also drops when the engine is switched off
                // at a fuel stop, and ending a trip on that alone would
                // manufacture the exact split it is meant to prevent.
                // Whether this ends a drive is a scoring decision made
                // with more evidence than one event.
                event.put("wakeAttempted", false);
                event.put("wakeOutcome", TaxotticCarSignalStore.WAKE_NOT_A_WAKE_SOURCE);
                event.put("wakeDetail", "trip_end_hint_only");
            }

            TaxotticCarSignalStore.record(app, event);
        } catch (JSONException e) {
            Log.e(TAG, "Could not build Bluetooth signal event", e);
        }
    }

    /**
     * A car connect is a wake source. Acting on it is subject to exactly
     * the discipline TaxotticGeofenceReceiver established, for the same
     * reason.
     *
     * The Bluetooth broadcast is a documented exemption from the Android
     * 12+ ban on background foreground-service starts, so it lets us
     * START. It grants no location access whatsoever. A location
     * foreground service started without usable background location runs,
     * posts a notification, and sees nothing, which is indistinguishable
     * from working and is the precise failure mode this whole effort
     * exists to remove. So we refuse, and we record the refusal where a
     * human can read it, rather than running blind.
     */
    private void applyWake(Context app, JSONObject event) throws JSONException {
        if (TaxotticGeofenceStore.isCaptureRunning(app)) {
            event.put("wakeAttempted", false);
            event.put("wakeOutcome", TaxotticCarSignalStore.WAKE_ALREADY_RUNNING);
            return;
        }

        if (!TaxotticGeofenceReceiver.hasBackgroundLocation(app)) {
            event.put("wakeAttempted", true);
            event.put("wakeOutcome", TaxotticCarSignalStore.WAKE_NO_BACKGROUND_PERMISSION);
            event.put("wakeDetail", "ACCESS_BACKGROUND_LOCATION not granted");
            Log.w(TAG, "Car Bluetooth connect ignored: ACCESS_BACKGROUND_LOCATION is not "
                    + "granted, so a location foreground service started now would be blind.");
            return;
        }

        Intent serviceIntent = new Intent(app, TaxotticResurrectionService.class);
        serviceIntent.putExtra(TaxotticResurrectionService.EXTRA_SOURCE,
                TaxotticResurrectionService.SOURCE_BLUETOOTH);
        try {
            ContextCompat.startForegroundService(app, serviceIntent);
            event.put("wakeAttempted", true);
            event.put("wakeOutcome", TaxotticCarSignalStore.WAKE_STARTED);
        } catch (Exception e) {
            // ForegroundServiceStartNotAllowedException on API 31+ if
            // the Bluetooth exemption did not apply on this build.
            // Recorded, never swallowed: this is the single fact that
            // tells us whether the exemption is real on a given OEM.
            Log.e(TAG, "Could not start capture from car Bluetooth connect", e);
            event.put("wakeAttempted", true);
            event.put("wakeOutcome", TaxotticCarSignalStore.WAKE_SERVICE_START_DENIED);
            event.put("wakeDetail", e.getClass().getSimpleName());
        }
    }

    // ------------------------------------------------------------------
    // Class decoding
    // ------------------------------------------------------------------

    /**
     * The vehicle test.
     *
     * CAR_AUDIO is a head unit. HANDSFREE is the hands-free profile a
     * car kit advertises. Those two, and deliberately not the rest of the
     * audio-video class: HEADPHONES, WEARABLE_HEADSET, LOUDSPEAKER and
     * HIFI_AUDIO are the ones a driver also connects at a desk, on a run,
     * or in a kitchen, and starting a location foreground service because
     * someone put headphones on would be both a battery cost and a
     * fabricated trip. A false vehicle here is worse than a missed one,
     * because mileage numbers are IRS-deductible.
     *
     * HANDSFREE is the looser of the two and does catch some
     * speakerphone-capable headsets. It is kept because the miss it
     * prevents (a car kit that reports handsfree rather than car audio,
     * which is common on older vehicles) costs a whole drive, while the
     * false positive it allows costs a capture session that finds no
     * movement and closes itself on the stationary rule within six
     * minutes.
     */
    static boolean isVehicleClass(int deviceClass) {
        return deviceClass == BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO
                || deviceClass == BluetoothClass.Device.AUDIO_VIDEO_HANDSFREE;
    }

    private static String majorClassName(int major) {
        switch (major) {
            case BluetoothClass.Device.Major.AUDIO_VIDEO: return "audio_video";
            case BluetoothClass.Device.Major.COMPUTER: return "computer";
            case BluetoothClass.Device.Major.HEALTH: return "health";
            case BluetoothClass.Device.Major.IMAGING: return "imaging";
            case BluetoothClass.Device.Major.MISC: return "misc";
            case BluetoothClass.Device.Major.NETWORKING: return "networking";
            case BluetoothClass.Device.Major.PERIPHERAL: return "peripheral";
            case BluetoothClass.Device.Major.PHONE: return "phone";
            case BluetoothClass.Device.Major.TOY: return "toy";
            case BluetoothClass.Device.Major.WEARABLE: return "wearable";
            case BluetoothClass.Device.Major.UNCATEGORIZED: return "uncategorized";
            default: return "unknown";
        }
    }

    /**
     * Only the audio-video members are named, because only those reach
     * this far. The raw value travels with every event, so a class we
     * did not name is still fully recoverable downstream.
     */
    private static String deviceClassName(int deviceClass) {
        switch (deviceClass) {
            case BluetoothClass.Device.AUDIO_VIDEO_CAR_AUDIO: return "car_audio";
            case BluetoothClass.Device.AUDIO_VIDEO_HANDSFREE: return "handsfree";
            case BluetoothClass.Device.AUDIO_VIDEO_HEADPHONES: return "headphones";
            case BluetoothClass.Device.AUDIO_VIDEO_HIFI_AUDIO: return "hifi_audio";
            case BluetoothClass.Device.AUDIO_VIDEO_LOUDSPEAKER: return "loudspeaker";
            case BluetoothClass.Device.AUDIO_VIDEO_MICROPHONE: return "microphone";
            case BluetoothClass.Device.AUDIO_VIDEO_PORTABLE_AUDIO: return "portable_audio";
            case BluetoothClass.Device.AUDIO_VIDEO_SET_TOP_BOX: return "set_top_box";
            case BluetoothClass.Device.AUDIO_VIDEO_UNCATEGORIZED: return "uncategorized";
            case BluetoothClass.Device.AUDIO_VIDEO_VCR: return "vcr";
            case BluetoothClass.Device.AUDIO_VIDEO_VIDEO_CAMERA: return "video_camera";
            case BluetoothClass.Device.AUDIO_VIDEO_VIDEO_CONFERENCING: return "video_conferencing";
            case BluetoothClass.Device.AUDIO_VIDEO_VIDEO_DISPLAY_AND_LOUDSPEAKER:
                return "display_and_loudspeaker";
            case BluetoothClass.Device.AUDIO_VIDEO_VIDEO_MONITOR: return "video_monitor";
            case BluetoothClass.Device.AUDIO_VIDEO_WEARABLE_HEADSET: return "wearable_headset";
            default: return "unknown";
        }
    }

    // ------------------------------------------------------------------
    // Intent extraction
    // ------------------------------------------------------------------

    @SuppressWarnings("deprecation")
    private static BluetoothDevice deviceFrom(Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice.class);
            }
            return intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE);
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * Prefer the class the broadcast handed us over asking the adapter.
     *
     * EXTRA_CLASS travels inside the intent we were already delivered, so
     * reading it costs nothing and cannot throw. getBluetoothClass() is
     * a call into the Bluetooth stack that is permission-gated on API
     * 31+, and is only worth attempting as a fallback.
     */
    @SuppressWarnings("deprecation")
    private static BluetoothClass classFrom(Intent intent, BluetoothDevice device) {
        try {
            BluetoothClass fromIntent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                fromIntent = intent.getParcelableExtra(
                        BluetoothDevice.EXTRA_CLASS, BluetoothClass.class);
            } else {
                fromIntent = intent.getParcelableExtra(BluetoothDevice.EXTRA_CLASS);
            }
            if (fromIntent != null) return fromIntent;
        } catch (Exception ignored) {
            // Fall through to the device lookup.
        }
        if (device == null) return null;
        try {
            return device.getBluetoothClass();
        } catch (SecurityException e) {
            return null;
        }
    }

    private static String addressOf(BluetoothDevice device) {
        if (device == null) return null;
        try {
            return device.getAddress();
        } catch (SecurityException e) {
            return null;
        }
    }

    /**
     * The human-readable name is the one field that is genuinely
     * permission-gated rather than merely delivered alongside a gated
     * broadcast, and it is the only field a driver can recognise when
     * confirming "yes, that is my car". Absent, everything still works
     * on the hashed identifier; the pairing screen just has nothing
     * friendly to show.
     */
    private static String nameOf(Context context, BluetoothDevice device) {
        if (device == null) return null;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT)
                        != PackageManager.PERMISSION_GRANTED) {
            return null;
        }
        try {
            return device.getName();
        } catch (SecurityException e) {
            return null;
        }
    }

    private static Object orNull(String value) {
        return value == null || value.isEmpty() ? JSONObject.NULL : value;
    }
}
