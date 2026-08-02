package com.taxottic.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.content.Intent;
import android.os.Parcel;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Drives the real car-Bluetooth receiver on a real device.
 *
 * This test exists because of a specific limitation and a specific
 * repo rule. The limitation: an emulator has no Bluetooth car radio, so
 * no amount of running the app produces an ACL_CONNECTED from a head
 * unit, and `adb shell am broadcast` cannot attach the BluetoothClass
 * parcelable that the whole vehicle decision reads. The rule: this
 * project has shipped native code that was never compiled in, so a
 * behaviour is not considered verified until it has been observed in a
 * built artifact rather than reasoned about in source.
 *
 * So the receiver is invoked directly, on-device, through the same
 * Intent the platform would deliver, with a BluetoothClass rebuilt from
 * its own parcel format. What that proves is everything from
 * onReceive() inward: class decoding, the vehicle filter, the
 * permission refusal, the event shape and its durability. What it
 * cannot prove is that Android delivers the broadcast to a
 * manifest-declared receiver in a killed process. That needs a car.
 */
@RunWith(AndroidJUnit4.class)
public class TaxotticCarBluetoothReceiverTest {

    /**
     * Bluetooth class-of-device bit patterns, from the assigned-numbers
     * spec. getMajorDeviceClass() masks with 0x1F00 and getDeviceClass()
     * with 0x1FFC, so these produce the major and minor pairs below.
     */
    private static final int COD_CAR_AUDIO = 0x0420;
    private static final int COD_HANDSFREE = 0x0408;
    private static final int COD_HEADPHONES = 0x0418;
    private static final int COD_SMARTPHONE = 0x020C;

    private Context context;
    private TaxotticCarBluetoothReceiver receiver;

    @Before
    public void setUp() {
        context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        receiver = new TaxotticCarBluetoothReceiver();
        // Start from an empty buffer so each assertion reads the event
        // this test just produced and not one left by the app.
        TaxotticCarSignalStore.consumeSignals(context, Integer.MAX_VALUE);
        assertEquals(0, TaxotticCarSignalStore.countSignals(context));
        clearCaptureState();
    }

    /**
     * One test genuinely starts the location foreground service, so it
     * has to be stopped or the next test sees a live capture and every
     * wake assertion after it reads "already_running".
     */
    @After
    public void tearDown() {
        try {
            Intent stop = new Intent(context, TaxotticResurrectionService.class);
            stop.setAction(TaxotticResurrectionService.ACTION_STOP);
            context.startService(stop);
        } catch (Exception ignored) {
            // Nothing running is the common case and is not a failure.
        }
        clearCaptureState();
    }

    private void clearCaptureState() {
        TaxotticGeofenceStore.recordCapture(
                context, TaxotticGeofenceStore.CAPTURE_ENDED, "test_reset", 0, 0, false);
    }

    @Test
    public void carAudioConnectIsAVehicleSignal() throws Exception {
        deliver(BluetoothDevice.ACTION_ACL_CONNECTED, COD_CAR_AUDIO, "AA:BB:CC:DD:EE:01");

        JSONObject event = onlySignal();
        assertEquals("bluetooth", event.getString("kind"));
        assertEquals("connected", event.getString("state"));
        assertTrue("car audio must be treated as a vehicle",
                event.getBoolean("vehicleClass"));
        assertEquals("audio_video", event.getString("deviceMajorClass"));
        assertEquals("car_audio", event.getString("deviceClass"));
        assertEquals(0x0400, event.getInt("deviceMajorClassRaw"));
        assertEquals(COD_CAR_AUDIO, event.getInt("deviceClassRaw"));
    }

    @Test
    public void handsfreeConnectIsAVehicleSignal() throws Exception {
        deliver(BluetoothDevice.ACTION_ACL_CONNECTED, COD_HANDSFREE, "AA:BB:CC:DD:EE:02");

        JSONObject event = onlySignal();
        assertTrue("a handsfree car kit must be treated as a vehicle",
                event.getBoolean("vehicleClass"));
        assertEquals("handsfree", event.getString("deviceClass"));
    }

    /**
     * The false-positive guard. Putting headphones on must never start a
     * location foreground service: mileage numbers are IRS-deductible and
     * a fabricated trip is worse than a missed one.
     */
    @Test
    public void headphonesAreLoggedButNeverWake() throws Exception {
        deliver(BluetoothDevice.ACTION_ACL_CONNECTED, COD_HEADPHONES, "AA:BB:CC:DD:EE:03");

        JSONObject event = onlySignal();
        assertFalse(event.getBoolean("vehicleClass"));
        assertEquals("headphones", event.getString("deviceClass"));
        assertFalse(event.getBoolean("wakeAttempted"));
        assertEquals(TaxotticCarSignalStore.WAKE_NOT_VEHICLE_CLASS,
                event.getString("wakeOutcome"));
    }

    /**
     * Everything outside the audio-video class is counted and never
     * written. The user's watch, keyboard and phone are not ours to log.
     */
    @Test
    public void nonAudioDevicesAreNotLoggedAtAll() throws Exception {
        int before = TaxotticCarSignalStore.snapshot(context).getInt("ignoredEvents");

        deliver(BluetoothDevice.ACTION_ACL_CONNECTED, COD_SMARTPHONE, "AA:BB:CC:DD:EE:04");

        assertEquals("a phone connecting must not appear in the signal log",
                0, bluetoothSignalCount(context));
        assertEquals("but it must still be counted, so a zero here means "
                        + "no broadcasts rather than no car",
                before + 1, TaxotticCarSignalStore.snapshot(context).getInt("ignoredEvents"));
    }

    /**
     * A disconnect is a trip-END hint and is emitted as evidence only.
     * This receiver must not stop capture: a car radio also drops when
     * the engine is switched off at a fuel stop, and ending a trip on
     * that alone manufactures the split it is meant to prevent.
     */
    @Test
    public void carDisconnectIsEmittedAndNeverActedOn() throws Exception {
        deliver(BluetoothDevice.ACTION_ACL_DISCONNECTED, COD_CAR_AUDIO, "AA:BB:CC:DD:EE:05");

        JSONObject event = onlySignal();
        assertEquals("disconnected", event.getString("state"));
        assertTrue(event.getBoolean("vehicleClass"));
        assertFalse(event.getBoolean("wakeAttempted"));
        assertEquals(TaxotticCarSignalStore.WAKE_NOT_A_WAKE_SOURCE,
                event.getString("wakeOutcome"));
    }

    /**
     * The discipline TaxotticGeofenceReceiver established, applied to the
     * new wake source.
     *
     * A wake event lets us start a foreground service. It grants no
     * location. A location service started without usable background
     * location runs, posts a notification and sees nothing, which is
     * indistinguishable from working. So the receiver refuses and records
     * why, and this test only means what it says because the test app has
     * no ACCESS_BACKGROUND_LOCATION grant, which is asserted rather than
     * assumed.
     */
    @Test
    public void carConnectRefusesToStartCaptureWithoutBackgroundLocation() throws Exception {
        Context denied = new FixedPermissionContext(context, false);
        assertFalse("the override must have taken, or this test proves nothing",
                TaxotticGeofenceReceiver.hasBackgroundLocation(denied));

        deliver(denied, BluetoothDevice.ACTION_ACL_CONNECTED, COD_CAR_AUDIO, "AA:BB:CC:DD:EE:06");

        JSONObject event = onlySignal();
        assertTrue("the wake fired", event.getBoolean("wakeAttempted"));
        assertEquals("and refused, loudly",
                TaxotticCarSignalStore.WAKE_NO_BACKGROUND_PERMISSION,
                event.getString("wakeOutcome"));
        assertEquals("ACCESS_BACKGROUND_LOCATION not granted",
                event.getString("wakeDetail"));
        assertFalse("nothing may be capturing after a refusal",
                TaxotticGeofenceStore.isCaptureRunning(context));

        JSONObject health = TaxotticCarSignalStore.snapshot(context);
        assertEquals("and the refusal is readable without opening the buffer, "
                        + "which is what makes it visible in health rather than silent",
                TaxotticCarSignalStore.WAKE_NO_BACKGROUND_PERMISSION,
                health.getString("lastWakeOutcome"));
    }

    /**
     * The other half of the same rule: when location genuinely is usable,
     * a car connect must start capture, and the buffered fixes must be
     * attributable to this wake source rather than to the geofence mesh.
     *
     * Without this test the refusal above would be satisfied by a
     * receiver that never starts anything at all.
     */
    @Test
    public void carConnectStartsCaptureWhenBackgroundLocationIsUsable() throws Exception {
        Context allowed = new FixedPermissionContext(context, true);
        assertTrue(TaxotticGeofenceReceiver.hasBackgroundLocation(allowed));

        deliver(allowed, BluetoothDevice.ACTION_ACL_CONNECTED, COD_CAR_AUDIO, "AA:BB:CC:DD:EE:0A");

        JSONObject event = onlySignal();
        assertTrue(event.getBoolean("wakeAttempted"));
        assertEquals(TaxotticCarSignalStore.WAKE_STARTED, event.getString("wakeOutcome"));
    }

    /** A car connect during an existing session must not restart GPS. */
    @Test
    public void carConnectDoesNothingWhileAlreadyCapturing() throws Exception {
        TaxotticGeofenceStore.recordCapture(context, TaxotticGeofenceStore.CAPTURE_FIXES,
                "test", 1, System.currentTimeMillis(), true);
        assertTrue(TaxotticGeofenceStore.isCaptureRunning(context));

        deliver(BluetoothDevice.ACTION_ACL_CONNECTED, COD_CAR_AUDIO, "AA:BB:CC:DD:EE:0B");

        JSONObject event = onlySignal();
        assertFalse(event.getBoolean("wakeAttempted"));
        assertEquals(TaxotticCarSignalStore.WAKE_ALREADY_RUNNING,
                event.getString("wakeOutcome"));
    }

    /** The identifier must be stable across connections and never a MAC. */
    @Test
    public void deviceIdIsStableAndNotTheAddress() throws Exception {
        String address = "AA:BB:CC:DD:EE:07";
        deliver(BluetoothDevice.ACTION_ACL_CONNECTED, COD_CAR_AUDIO, address);
        deliver(BluetoothDevice.ACTION_ACL_DISCONNECTED, COD_CAR_AUDIO, address);

        JSONArray signals = bluetoothSignals();
        assertEquals(2, signals.length());
        String first = signals.getJSONObject(0).getString("deviceId");
        String second = signals.getJSONObject(1).getString("deviceId");
        assertNotNull(first);
        assertEquals("the same car must read as the same car", first, second);
        assertFalse("the stored id must not contain the hardware address",
                first.toUpperCase().contains(address.replace(":", "")));
        assertFalse(first.contains(":"));
    }

    /**
     * The monotonic clock is only usable if a consumer can tell whether
     * two readings share an origin, so bootAtMs must agree with the pair
     * it was derived from.
     */
    @Test
    public void timestampsAreSelfConsistent() throws Exception {
        deliver(BluetoothDevice.ACTION_ACL_CONNECTED, COD_CAR_AUDIO, "AA:BB:CC:DD:EE:08");

        JSONObject event = onlySignal();
        long atMs = event.getLong("atMs");
        long elapsed = event.getLong("elapsedRealtimeMs");
        long bootAtMs = event.getLong("bootAtMs");
        assertTrue("the monotonic clock must be running", elapsed > 0);
        assertTrue("bootAtMs must be atMs minus elapsed, rounded to the second",
                Math.abs((atMs - elapsed) - bootAtMs) < 1000);
        assertEquals(TaxotticCarSignalStore.SCHEMA_VERSION, event.getInt("v"));
    }

    /** Consuming must take from the head, oldest first, and no further. */
    @Test
    public void consumeDropsTheOldestFirst() throws Exception {
        deliver(BluetoothDevice.ACTION_ACL_CONNECTED, COD_CAR_AUDIO, "AA:BB:CC:DD:EE:09");
        deliver(BluetoothDevice.ACTION_ACL_DISCONNECTED, COD_CAR_AUDIO, "AA:BB:CC:DD:EE:09");
        int total = TaxotticCarSignalStore.countSignals(context);
        assertEquals(2, bluetoothSignalCount(context));

        TaxotticCarSignalStore.consumeSignals(context, 1);

        assertEquals(total - 1, TaxotticCarSignalStore.countSignals(context));
        JSONArray remaining = bluetoothSignals();
        assertEquals("the newest survives", "disconnected",
                remaining.getJSONObject(remaining.length() - 1).getString("state"));
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    /**
     * A context that reports a fixed answer for ACCESS_BACKGROUND_LOCATION.
     *
     * Both halves of the permission rule have to be exercised, and
     * neither is reachable from the device's own state: Gradle installs
     * the app under test with every runtime permission granted, so the
     * interesting case never occurs, and actually revoking the
     * permission at runtime kills the app process, which takes the test
     * runner with it. That was tried first and crashed the run.
     *
     * getApplicationContext() is overridden to return this wrapper
     * because the receiver, correctly, does its work against the
     * application context, and a plain ContextWrapper would hand back
     * the real one and quietly undo the override.
     */
    private static final class FixedPermissionContext extends android.content.ContextWrapper {
        private final boolean granted;

        FixedPermissionContext(Context base, boolean granted) {
            super(base);
            this.granted = granted;
        }

        @Override
        public Context getApplicationContext() {
            return this;
        }

        @Override
        public int checkSelfPermission(String permission) {
            if (android.Manifest.permission.ACCESS_BACKGROUND_LOCATION.equals(permission)
                    || android.Manifest.permission.ACCESS_FINE_LOCATION.equals(permission)) {
                return granted
                        ? android.content.pm.PackageManager.PERMISSION_GRANTED
                        : android.content.pm.PackageManager.PERMISSION_DENIED;
            }
            return super.checkSelfPermission(permission);
        }

        @Override
        public int checkPermission(String permission, int pid, int uid) {
            if (android.Manifest.permission.ACCESS_BACKGROUND_LOCATION.equals(permission)
                    || android.Manifest.permission.ACCESS_FINE_LOCATION.equals(permission)) {
                return granted
                        ? android.content.pm.PackageManager.PERMISSION_GRANTED
                        : android.content.pm.PackageManager.PERMISSION_DENIED;
            }
            return super.checkPermission(permission, pid, uid);
        }
    }

    private void deliver(String action, int classOfDevice, String address) {
        deliver(context, action, classOfDevice, address);
    }

    private void deliver(Context ctx, String action, int classOfDevice, String address) {
        Intent intent = new Intent(action);
        intent.putExtra(BluetoothDevice.EXTRA_CLASS, bluetoothClass(classOfDevice));
        BluetoothDevice device = remoteDevice(address);
        if (device != null) intent.putExtra(BluetoothDevice.EXTRA_DEVICE, device);
        receiver.onReceive(ctx, intent);
    }

    /**
     * BluetoothClass has no public constructor, so it is rebuilt from its
     * own parcel format, which is a single int holding the class of
     * device. This is the same object the platform hands us in
     * EXTRA_CLASS, not a stand-in for it.
     */
    private static BluetoothClass bluetoothClass(int classOfDevice) {
        Parcel parcel = Parcel.obtain();
        try {
            parcel.writeInt(classOfDevice);
            parcel.setDataPosition(0);
            return BluetoothClass.CREATOR.createFromParcel(parcel);
        } finally {
            parcel.recycle();
        }
    }

    private BluetoothDevice remoteDevice(String address) {
        try {
            BluetoothManager manager =
                    (BluetoothManager) context.getSystemService(Context.BLUETOOTH_SERVICE);
            BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
            return adapter == null ? null : adapter.getRemoteDevice(address);
        } catch (Exception e) {
            // A device with no Bluetooth hardware still exercises every
            // class-decoding and wake path; only the identifier is lost.
            return null;
        }
    }

    /**
     * The one Bluetooth signal this test produced.
     *
     * Filtered by kind rather than taking the only entry, because the
     * live app shares this store: the projection observer emits a
     * "not connected" signal the first time it attaches, and that
     * genuinely can land mid-test. Asserting on the whole buffer made
     * this suite fail for a reason that had nothing to do with the
     * receiver under test.
     */
    private JSONObject onlySignal() throws Exception {
        JSONArray all = TaxotticCarSignalStore.readSignals(context);
        JSONObject found = null;
        int count = 0;
        for (int i = 0; i < all.length(); i++) {
            JSONObject event = all.getJSONObject(i);
            if (TaxotticCarSignalStore.KIND_BLUETOOTH.equals(event.optString("kind"))) {
                found = event;
                count++;
            }
        }
        assertEquals("expected exactly one Bluetooth signal", 1, count);
        assertNotNull(found);
        return found;
    }

    private JSONArray bluetoothSignals() throws Exception {
        JSONArray all = TaxotticCarSignalStore.readSignals(context);
        JSONArray out = new JSONArray();
        for (int i = 0; i < all.length(); i++) {
            JSONObject event = all.getJSONObject(i);
            if (TaxotticCarSignalStore.KIND_BLUETOOTH.equals(event.optString("kind"))) {
                out.put(event);
            }
        }
        return out;
    }

    private static int bluetoothSignalCount(Context context) {
        JSONArray all = TaxotticCarSignalStore.readSignals(context);
        int count = 0;
        for (int i = 0; i < all.length(); i++) {
            JSONObject event = all.optJSONObject(i);
            if (event != null
                    && TaxotticCarSignalStore.KIND_BLUETOOTH.equals(event.optString("kind"))) {
                count++;
            }
        }
        return count;
    }
}
