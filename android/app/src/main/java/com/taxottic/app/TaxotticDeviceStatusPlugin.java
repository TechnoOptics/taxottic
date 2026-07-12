package com.taxottic.app;

import android.Manifest;
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
@CapacitorPlugin(name = "TaxotticDeviceStatus")
public class TaxotticDeviceStatusPlugin extends Plugin {

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
