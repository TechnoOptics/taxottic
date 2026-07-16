package com.taxottic.app;

import android.Manifest;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayDeque;

/**
 * Device-truth probe for mileage reliability (plan §C), Android side.
 * Reports what nothing else in the stack can see: whether background
 * location ("Allow all the time") is actually granted, and whether the
 * OS is battery-optimizing Taxottic — the Samsung starvation that
 * reduced capture to 2 fixes per drive has NO other detectable signal.
 *
 * Also exposes the two battery-exemption intents the setup wizard
 * drives: the direct request dialog (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
 * on Google's acceptable-use list for apps whose core function breaks
 * under Doze — continuous mileage tracking is the canonical case) and
 * the policy-safe settings list as fallback.
 */
@CapacitorPlugin(
        name = "TaxotticDeviceStatus",
        permissions = {
            @Permission(
                strings = { Manifest.permission.ACTIVITY_RECOGNITION },
                alias = "motion")
        })
public class TaxotticDeviceStatusPlugin extends Plugin {

    /**
     * Walk-away drive-end support (lib/mileage/drive-end.ts): Android's
     * TYPE_STEP_COUNTER only reports a CUMULATIVE count since boot, so
     * to answer "steps since T" we keep a small ring of (wall-clock ms,
     * cumulative) samples while the plugin is alive and difference the
     * latest against the sample at/just before T. Costs nothing when the
     * sensor is quiet (event-driven) and needs ACTIVITY_RECOGNITION on
     * API 29+ (the "motion" alias below; degraded gracefully to
     * available:false when missing so the tracker falls back to its
     * stationary timeout).
     */
    private static final int STEP_RING_MAX = 360;
    private final ArrayDeque<long[]> stepRing = new ArrayDeque<>();
    private SensorManager sensorManager;
    private boolean stepListenerArmed = false;
    private final SensorEventListener stepListener = new SensorEventListener() {
        @Override public void onSensorChanged(SensorEvent event) {
            synchronized (stepRing) {
                stepRing.addLast(new long[] {
                        System.currentTimeMillis(), (long) event.values[0] });
                while (stepRing.size() > STEP_RING_MAX) stepRing.removeFirst();
            }
        }
        @Override public void onAccuracyChanged(Sensor sensor, int accuracy) {}
    };

    private boolean hasMotionPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                || granted(Manifest.permission.ACTIVITY_RECOGNITION);
    }

    private void armStepListener() {
        if (stepListenerArmed || !hasMotionPermission()) return;
        if (sensorManager == null) {
            sensorManager = (SensorManager)
                    getContext().getSystemService(Context.SENSOR_SERVICE);
        }
        if (sensorManager == null) return;
        Sensor stepSensor = sensorManager.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
        if (stepSensor == null) return;
        stepListenerArmed = sensorManager.registerListener(
                stepListener, stepSensor, SensorManager.SENSOR_DELAY_NORMAL);
    }

    @Override
    public void load() {
        armStepListener();
    }

    /** Steps since `fromMs`. available=false when the sensor/permission
     *  is missing OR we have no baseline sample at/before fromMs yet
     *  (just armed) — callers treat that as 0 and use the timeout. */
    @PluginMethod
    public void queryStepsSince(PluginCall call) {
        armStepListener(); // re-try in case permission arrived after load
        JSObject out = new JSObject();
        if (!stepListenerArmed) {
            out.put("steps", 0);
            out.put("available", false);
            call.resolve(out);
            return;
        }
        long fromMs = (long) call.getDouble("fromMs", 0.0).doubleValue();
        long baseline = -1;
        long latest = -1;
        synchronized (stepRing) {
            for (long[] sample : stepRing) {
                if (sample[0] <= fromMs) baseline = sample[1];
                latest = sample[1];
            }
        }
        if (baseline < 0 || latest < 0) {
            out.put("steps", 0);
            out.put("available", false);
        } else {
            out.put("steps", Math.max(0, latest - baseline));
            out.put("available", true);
        }
        call.resolve(out);
    }

    /** Prompt for ACTIVITY_RECOGNITION (the setup wizard's fix button
     *  for the walk-away drive-end check). */
    @PluginMethod
    public void requestActivityRecognition(PluginCall call) {
        if (hasMotionPermission()) {
            armStepListener();
            JSObject out = new JSObject();
            out.put("granted", true);
            call.resolve(out);
            return;
        }
        requestPermissionForAlias("motion", call, "motionPermissionCallback");
    }

    @PermissionCallback
    private void motionPermissionCallback(PluginCall call) {
        boolean ok = hasMotionPermission();
        if (ok) armStepListener();
        JSObject out = new JSObject();
        out.put("granted", ok);
        call.resolve(out);
    }

    private boolean granted(String permission) {
        return ContextCompat.checkSelfPermission(getContext(), permission)
                == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        Context ctx = getContext();
        boolean fine = granted(Manifest.permission.ACCESS_FINE_LOCATION);
        boolean coarse = granted(Manifest.permission.ACCESS_COARSE_LOCATION);
        boolean background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION);

        String auth;
        if (!fine && !coarse) {
            auth = "denied";
        } else if (background) {
            auth = "always";
        } else {
            auth = "whenInUse";
        }

        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        boolean ignoring = pm != null
                && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());

        JSObject out = new JSObject();
        out.put("platform", "android");
        out.put("locationAuthorization", auth);
        out.put("preciseLocation", fine);
        out.put("batteryOptimized", !ignoring);
        out.put("manufacturer", Build.MANUFACTURER);
        out.put("motionPermission", hasMotionPermission());
        call.resolve(out);
    }

    /** Direct exemption dialog ("Allow Taxottic to always run in
     *  background?"). Requires the manifest permission added alongside
     *  this plugin. */
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        try {
            Intent intent = new Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("battery_exemption_unavailable: " + e.getMessage());
        }
    }

    /** Deep-link straight to THIS app's Location permission screen so
     *  the user can flip "Allow all the time" without hunting through
     *  App info → Permissions → Location. The Capgo plugin's
     *  openSettings() only reaches the generic app-details page, which
     *  read as "the location button does nothing useful". Falls back to
     *  app-details if the manage-permission intent is unavailable. */
    @PluginMethod
    public void openLocationSettings(PluginCall call) {
        Context ctx = getContext();
        String pkg = ctx.getPackageName();
        Uri uri = Uri.fromParts("package", pkg, null);
        // MANAGE_APP_PERMISSION targets the specific permission group on
        // API 31+; fall back to the app's permission list, then details.
        Intent[] tries = new Intent[] {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                ? new Intent("android.intent.action.MANAGE_APP_PERMISSION")
                    .putExtra("android.intent.extra.PACKAGE_NAME", pkg)
                    .putExtra("android.intent.extra.PERMISSION_GROUP_NAME",
                              "android.permission-group.LOCATION")
                : null,
            new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, uri),
        };
        for (Intent intent : tries) {
            if (intent == null) continue;
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            try {
                ctx.startActivity(intent);
                call.resolve();
                return;
            } catch (Exception ignored) { /* try next */ }
        }
        call.reject("location_settings_unavailable");
    }

    /** Policy-safe fallback: the full battery-optimization list where
     *  the user exempts Taxottic manually. */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        try {
            Intent intent = new Intent(
                    Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("battery_settings_unavailable: " + e.getMessage());
        }
    }
}
