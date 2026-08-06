package com.taxottic.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * JS bridge for the car-connection signals.
 *
 * This plugin hands over observations. It does not decide anything and
 * it does not start tracking. Everything that has to work while the
 * WebView is dead already happens without it, in the manifest-declared
 * receivers; this only lets the web layer read what those receivers
 * recorded, drain it once it is safely consumed, and ask for the one
 * runtime permission the feature needs.
 *
 * MUST be registered in MainActivity.onCreate. An unregistered plugin
 * compiles fine, ships, and is simply absent at runtime, which this
 * project has already done once: TaxotticDeviceStatusPlugin was dead for
 * weeks. The receivers do not depend on this class existing, so a
 * registration mistake here would degrade to "signals accumulate and
 * nobody reads them" rather than to "no signals", which is precisely why
 * it needs saying out loud rather than trusting it to be noticed.
 */
@CapacitorPlugin(
        name = "TaxotticCarSignals",
        permissions = {
            @Permission(
                    alias = TaxotticCarSignalsPlugin.ALIAS_BLUETOOTH,
                    strings = { Manifest.permission.BLUETOOTH_CONNECT })
        })
public class TaxotticCarSignalsPlugin extends Plugin {

    static final String ALIAS_BLUETOOTH = "bluetooth";

    @Override
    public void load() {
        // Projection state needs our process alive to be observed at
        // all, so attach as soon as there is a process to attach to.
        // Idempotent, and also attached from the capture service.
        TaxotticCarProjectionMonitor.start(getContext());
        // Charging state is an implicit broadcast that Android 8+ does
        // not deliver to manifest receivers (measured, see
        // TaxotticCarPowerReceiver), so it is registered at runtime.
        TaxotticCarPowerReceiver.register(getContext());
        refreshBluetoothPermissionState();
    }

    /**
     * The whole durable health picture, failures included.
     *
     * Deliberately reports live permission and adapter state alongside
     * the stored counters, because the stored state is only as fresh as
     * the last event and the user can revoke a permission from Settings
     * without anything of ours running.
     */
    @PluginMethod
    public void getState(PluginCall call) {
        refreshBluetoothPermissionState();
        try {
            JSONObject snapshot = TaxotticCarSignalStore.snapshot(getContext());
            snapshot.put("bluetoothAdapter", adapterState());
            snapshot.put("backgroundLocation",
                    TaxotticGeofenceReceiver.hasBackgroundLocation(getContext()));
            call.resolve(JSObject.fromJSONObject(snapshot));
        } catch (JSONException e) {
            call.reject("car_signal_state_unreadable: " + e.getMessage());
        }
    }

    /**
     * Read buffered signals without removing them.
     *
     * Read-then-consume, not drain, for the same reason as the geofence
     * fix buffer: a consumer that dies mid-handoff must not take the
     * evidence with it.
     */
    @PluginMethod
    public void readSignals(PluginCall call) {
        JSONArray signals = TaxotticCarSignalStore.readSignals(getContext());
        Object[] items = new Object[signals.length()];
        for (int i = 0; i < signals.length(); i++) items[i] = signals.opt(i);
        JSObject out = new JSObject();
        out.put("signals", JSArray.from(items));
        out.put("count", signals.length());
        out.put("schemaVersion", TaxotticCarSignalStore.SCHEMA_VERSION);
        call.resolve(out);
    }

    /** Drop the oldest N signals, after the consumer has taken them. */
    @PluginMethod
    public void consumeSignals(PluginCall call) {
        Integer count = call.getInt("count", 0);
        TaxotticCarSignalStore.consumeSignals(getContext(), count == null ? 0 : count);
        JSObject out = new JSObject();
        out.put("remaining", TaxotticCarSignalStore.countSignals(getContext()));
        call.resolve(out);
    }

    /**
     * Ask for BLUETOOTH_CONNECT.
     *
     * This is a user-facing system dialog, so the web layer chooses the
     * moment. It should be a moment where the ask explains itself, which
     * means during mileage setup or right after a drive the app missed,
     * and never on first launch next to four other prompts. The plugin
     * enforces nothing about timing beyond refusing to ask twice
     * silently, because Android stops showing the dialog after a second
     * refusal and an app that keeps calling into a no-op learns nothing.
     *
     * A refusal is a supported outcome, not an error. It resolves with
     * granted:false, the state is written to durable health, and the
     * caller is expected to keep working exactly as before: every other
     * capture path, including the geofence resurrection mesh, is
     * untouched by this permission.
     */
    @PluginMethod
    public void requestBluetoothPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            // Below API 31 there is no runtime Bluetooth permission and
            // the ACL broadcasts are not permission-gated.
            TaxotticCarSignalStore.recordBluetoothPermission(
                    getContext(), TaxotticCarSignalStore.BT_PERMISSION_NOT_REQUIRED, false);
            call.resolve(permissionResult(TaxotticCarSignalStore.BT_PERMISSION_NOT_REQUIRED));
            return;
        }
        if (getPermissionState(ALIAS_BLUETOOTH) == PermissionState.GRANTED) {
            TaxotticCarSignalStore.recordBluetoothPermission(
                    getContext(), TaxotticCarSignalStore.BT_PERMISSION_GRANTED, true);
            call.resolve(permissionResult(TaxotticCarSignalStore.BT_PERMISSION_GRANTED));
            return;
        }
        requestPermissionForAlias(ALIAS_BLUETOOTH, call, "bluetoothPermissionCallback");
    }

    @PermissionCallback
    private void bluetoothPermissionCallback(PluginCall call) {
        String state = getPermissionState(ALIAS_BLUETOOTH) == PermissionState.GRANTED
                ? TaxotticCarSignalStore.BT_PERMISSION_GRANTED
                : TaxotticCarSignalStore.BT_PERMISSION_DENIED;
        TaxotticCarSignalStore.recordBluetoothPermission(getContext(), state, true);
        call.resolve(permissionResult(state));
    }

    private JSObject permissionResult(String state) {
        JSObject out = new JSObject();
        out.put("permission", state);
        out.put("granted", TaxotticCarSignalStore.BT_PERMISSION_GRANTED.equals(state)
                || TaxotticCarSignalStore.BT_PERMISSION_NOT_REQUIRED.equals(state));
        out.put("asked", TaxotticCarSignalStore.bluetoothPermissionAsked(getContext()));
        return out;
    }

    // ------------------------------------------------------------------
    // Live state
    // ------------------------------------------------------------------

    /**
     * Reconcile the stored permission state with reality.
     *
     * The stored value exists so a receiver running with no bridge can
     * still report why it saw nothing. It goes stale the moment the user
     * changes the setting from the system Settings app, which happens
     * with no notification to us, so every read through the bridge
     * corrects it first.
     */
    private void refreshBluetoothPermissionState() {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            TaxotticCarSignalStore.recordBluetoothPermission(
                    ctx, TaxotticCarSignalStore.BT_PERMISSION_NOT_REQUIRED, false);
            return;
        }
        boolean granted = ContextCompat.checkSelfPermission(ctx, Manifest.permission.BLUETOOTH_CONNECT)
                == PackageManager.PERMISSION_GRANTED;
        if (granted) {
            TaxotticCarSignalStore.recordBluetoothPermission(
                    ctx, TaxotticCarSignalStore.BT_PERMISSION_GRANTED, false);
        } else if (TaxotticCarSignalStore.bluetoothPermissionAsked(ctx)) {
            TaxotticCarSignalStore.recordBluetoothPermission(
                    ctx, TaxotticCarSignalStore.BT_PERMISSION_DENIED, false);
        } else {
            TaxotticCarSignalStore.recordBluetoothPermission(
                    ctx, TaxotticCarSignalStore.BT_PERMISSION_NOT_REQUESTED, false);
        }
    }

    /**
     * A granted permission on a phone with the radio switched off still
     * produces no events, and the two look identical from the signal log
     * alone. Report them apart.
     */
    private String adapterState() {
        try {
            BluetoothManager manager =
                    (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
            BluetoothAdapter adapter = manager == null ? null : manager.getAdapter();
            if (adapter == null) return "absent";
            return adapter.isEnabled() ? "on" : "off";
        } catch (SecurityException e) {
            return "unreadable";
        } catch (Exception e) {
            return "unreadable";
        }
    }
}
