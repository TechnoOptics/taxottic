package com.taxottic.app;

import android.Manifest;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.app.ActivityManager;
import android.app.ApplicationExitInfo;
import java.util.ArrayList;
import java.util.List;
import java.nio.charset.StandardCharsets;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.annotation.RequiresApi;
import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
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
 * OS is battery-optimizing Taxottic, the Samsung starvation that
 * reduced capture to 2 fixes per drive has NO other detectable signal.
 *
 * Also exposes the two battery-exemption intents the setup wizard
 * drives: the direct request dialog (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
 * on Google's acceptable-use list for apps whose core function breaks
 * under Doze; continuous mileage tracking is the canonical case) and
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
     *  (just armed); callers treat that as 0 and use the timeout. */
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
        call.resolve(buildStatus(getContext(), hasMotionPermission()));
    }

    /** The device-truth payload, as a pure function of the context so an
     *  instrumented test can pin its shape without a bridge. */
    static JSObject buildStatus(Context ctx, boolean motionPermission) {
        boolean fine = granted(ctx, Manifest.permission.ACCESS_FINE_LOCATION);
        boolean coarse = granted(ctx, Manifest.permission.ACCESS_COARSE_LOCATION);
        boolean background = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                || granted(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION);

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
        out.put("motionPermission", motionPermission);
        putBackgroundRestricted(ctx, out);
        return out;
    }

    private static boolean granted(Context ctx, String permission) {
        return ContextCompat.checkSelfPermission(ctx, permission)
                == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * ActivityManager.isBackgroundRestricted() (API 28+): the user, or
     * Samsung's "Deep sleeping apps", set RUN_ANY_IN_BACKGROUND to ignore
     * for this package. That is a different switch from battery
     * optimization (isIgnoringBatteryOptimizations above) and was never
     * reported, so a phone in that state read as healthy. Omitted below
     * API 28 rather than faked.
     */
    static void putBackgroundRestricted(Context ctx, JSObject out) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return;
        try {
            ActivityManager am =
                (ActivityManager) ctx.getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null) out.put("isBackgroundRestricted", am.isBackgroundRestricted());
        } catch (Exception ignored) {
            // A failed read must never take the rest of the payload down.
        }
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
    /**
     * Why Android killed us last time, straight from the OS.
     *
     * ApplicationExitInfo (API 30+) is the only first-party answer to
     * "tracking stopped and nothing crashed". We previously inferred the
     * cause from GPS silence, which cannot distinguish a Samsung battery
     * kill from a user force-stop from an OOM. This names it.
     *
     * REASON_EXCESSIVE_RESOURCE_USAGE and REASON_LOW_MEMORY are the OEM
     * battery-starvation signature; REASON_PERMISSION_CHANGE means the
     * user revoked location (the process is killed on that change);
     * REASON_USER_REQUESTED is a force-stop or swipe-away.
     *
     * getImportance() at time of death tells us whether the foreground
     * service was still alive, which separates "the OS killed a live
     * tracker" from "we were already cached and idle".
     *
     * Needs no permission for our own package.
     *
     * Every fetched record is reported, not only the newest. Ten days of
     * production on a Galaxy Z Fold 5 showed that each multi-day capture
     * gap was followed by a harmless wake-source death (low_memory at
     * importance 400 after a resurrection drive finished) that overwrote
     * the tracker's own death record before the next heartbeat, so for
     * four outages the cause was lost. The one record that survived
     * could not be attributed to the app process versus the WebView's
     * sandboxed renderer, because the process name was never kept.
     * `history` fixes both; the top-level fields stay as they were.
     */
    @PluginMethod
    public void getExitInfo(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("platform", "android");
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            ret.put("available", false);
            call.resolve(ret);
            return;
        }
        try {
            ActivityManager am =
                (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
            // The per-package ring buffer holds about 16 records.
            List<ApplicationExitInfo> exits =
                am.getHistoricalProcessExitReasons(null, 0, EXIT_HISTORY_MAX);
            List<ExitRecord> records = new ArrayList<>();
            if (exits != null) {
                for (ApplicationExitInfo exit : exits) records.add(ExitRecord.from(exit));
            }
            ret = shapeExitInfo(records);
            ret.put("platform", "android");
            putBackgroundRestricted(getContext(), ret);
        } catch (Exception e) {
            ret.put("available", false);
            ret.put("error", String.valueOf(e.getMessage()));
        }
        call.resolve(ret);
    }

    private static final int EXIT_HISTORY_MAX = 16;
    private static final int BREADCRUMB_MAX_CHARS = 200;

    /** A plain copy of one ApplicationExitInfo, which has no public
     *  constructor, so the JSON shaping below can be tested directly. */
    static final class ExitRecord {
        final String processName;
        final int reason;
        final int status;
        final int importance;
        final long timestamp;
        final String description;
        final byte[] stateSummary;
        final long pssKb;
        final long rssKb;

        ExitRecord(String processName, int reason, int status, int importance,
                long timestamp, String description, byte[] stateSummary,
                long pssKb, long rssKb) {
            this.processName = processName;
            this.reason = reason;
            this.status = status;
            this.importance = importance;
            this.timestamp = timestamp;
            this.description = description;
            this.stateSummary = stateSummary;
            this.pssKb = pssKb;
            this.rssKb = rssKb;
        }

        @RequiresApi(Build.VERSION_CODES.R)
        static ExitRecord from(ApplicationExitInfo info) {
            return new ExitRecord(info.getProcessName(), info.getReason(),
                    info.getStatus(), info.getImportance(), info.getTimestamp(),
                    info.getDescription(), info.getProcessStateSummary(),
                    info.getPss(), info.getRss());
        }
    }

    /** Records newest first, as the OS returns them. */
    static JSObject shapeExitInfo(List<ExitRecord> exits) {
        JSObject ret = new JSObject();
        if (exits == null || exits.isEmpty()) {
            ret.put("available", false);
            return ret;
        }
        ExitRecord last = exits.get(0);
        ret.put("available", true);
        ret.put("reason", last.reason);
        ret.put("reasonName", reasonName(last.reason));
        ret.put("status", last.status);
        ret.put("timestamp", last.timestamp);
        ret.put("importance", last.importance);
        // IMPORTANCE_FOREGROUND_SERVICE (125) or better means the
        // tracking service was still live when the OS killed us.
        ret.put("fgsWasAlive", fgsWasAlive(last.importance));
        ret.put("pssKb", last.pssKb);
        ret.put("rssKb", last.rssKb);
        if (last.description != null) ret.put("description", last.description);
        String crumb = breadcrumb(last.stateSummary);
        if (crumb != null) ret.put("breadcrumb", crumb);

        JSArray history = new JSArray();
        for (ExitRecord exit : exits) {
            JSObject entry = new JSObject();
            entry.put("processName", exit.processName);
            entry.put("reason", exit.reason);
            entry.put("reasonName", reasonName(exit.reason));
            entry.put("status", exit.status);
            entry.put("importance", exit.importance);
            entry.put("fgsWasAlive", fgsWasAlive(exit.importance));
            entry.put("timestamp", exit.timestamp);
            entry.put("pssKb", exit.pssKb);
            entry.put("rssKb", exit.rssKb);
            if (exit.description != null) entry.put("description", exit.description);
            String entryCrumb = breadcrumb(exit.stateSummary);
            if (entryCrumb != null) entry.put("breadcrumb", entryCrumb);
            history.put(entry);
        }
        ret.put("history", history);
        return ret;
    }

    private static boolean fgsWasAlive(int importance) {
        return importance
            <= ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND_SERVICE;
    }

    /** The setProcessStateSummary bytes as UTF-8, bounded so a stray
     *  binary summary cannot bloat the heartbeat. */
    private static String breadcrumb(byte[] summary) {
        if (summary == null) return null;
        String text = new String(summary, StandardCharsets.UTF_8);
        return text.length() > BREADCRUMB_MAX_CHARS
            ? text.substring(0, BREADCRUMB_MAX_CHARS)
            : text;
    }

    /** Leave a breadcrumb the NEXT exit record will carry, so we learn
     *  whether tracking was active when the process died. Capped at 128
     *  bytes by the platform; the system may throttle calls. */
    @PluginMethod
    public void setExitBreadcrumb(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                String note = call.getString("note", "");
                ActivityManager am =
                    (ActivityManager) getContext().getSystemService(Context.ACTIVITY_SERVICE);
                byte[] bytes = note.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 128) {
                    byte[] trimmed = new byte[128];
                    System.arraycopy(bytes, 0, trimmed, 0, 128);
                    bytes = trimmed;
                }
                am.setProcessStateSummary(bytes);
            } catch (Exception ignored) {
                // Throttled or unavailable. Never break the caller.
            }
        }
        call.resolve();
    }

    private static String reasonName(int reason) {
        switch (reason) {
            case ApplicationExitInfo.REASON_EXIT_SELF: return "exit_self";
            case ApplicationExitInfo.REASON_SIGNALED: return "signaled";
            case ApplicationExitInfo.REASON_LOW_MEMORY: return "low_memory";
            case ApplicationExitInfo.REASON_CRASH: return "crash";
            case ApplicationExitInfo.REASON_CRASH_NATIVE: return "crash_native";
            case ApplicationExitInfo.REASON_ANR: return "anr";
            case ApplicationExitInfo.REASON_INITIALIZATION_FAILURE: return "init_failure";
            case ApplicationExitInfo.REASON_PERMISSION_CHANGE: return "permission_change";
            case ApplicationExitInfo.REASON_EXCESSIVE_RESOURCE_USAGE: return "excessive_resource_usage";
            case ApplicationExitInfo.REASON_USER_REQUESTED: return "user_requested";
            case ApplicationExitInfo.REASON_USER_STOPPED: return "user_stopped";
            case ApplicationExitInfo.REASON_DEPENDENCY_DIED: return "dependency_died";
            case ApplicationExitInfo.REASON_OTHER: return "other";
            default: return "unknown_" + reason;
        }
    }

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
