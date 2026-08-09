package com.taxottic.app;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.List;

/**
 * JS bridge for the learned-place geofence mesh.
 *
 * The web layer owns the policy (which places, when to sync, what to do
 * with recovered points); this plugin owns only the platform calls and
 * the durable state. Nothing here starts tracking. Tracking is started
 * by TaxotticGeofenceReceiver when the platform delivers an exit, which
 * is the entire point: it has to work when this plugin, the bridge, and
 * the WebView do not exist.
 *
 * MUST be registered in MainActivity.onCreate. An unregistered plugin
 * compiles fine and is simply absent at runtime, which this project has
 * already shipped once (TaxotticDeviceStatusPlugin was dead for weeks).
 */
@CapacitorPlugin(name = "TaxotticGeofence")
public class TaxotticGeofencePlugin extends Plugin {

    private static final String TAG = "TaxotticGeofence";

    /**
     * Replace the monitored place list and re-register the mesh.
     *
     * @param call places: array of { id, latitude, longitude, radius, label }
     */
    @PluginMethod
    public void syncPlaces(PluginCall call) {
        Context ctx = getContext();
        JSArray incoming = call.getArray("places");
        JSONArray asJson = incoming == null ? new JSONArray() : incoming;
        List<JSONObject> kept = TaxotticGeofenceStore.savePlaces(ctx, asJson);
        String armState = TaxotticGeofenceRegistrar.reregister(ctx);
        JSObject out = new JSObject();
        out.put("accepted", kept.size());
        out.put("submitted", asJson.length());
        out.put("maxPlaces", TaxotticGeofenceStore.MAX_PLACES);
        out.put("armState", armState);
        out.put("backgroundLocation", TaxotticGeofenceReceiver.hasBackgroundLocation(ctx));
        call.resolve(out);
    }

    /** Full durable health picture, including every failure field. */
    @PluginMethod
    public void getState(PluginCall call) {
        try {
            JSONObject snapshot = TaxotticGeofenceStore.snapshot(getContext());
            snapshot.put("backgroundLocation",
                    TaxotticGeofenceReceiver.hasBackgroundLocation(getContext()));
            snapshot.put("maxPlaces", TaxotticGeofenceStore.MAX_PLACES);
            call.resolve(JSObject.fromJSONObject(snapshot));
        } catch (JSONException e) {
            call.reject("geofence_state_unreadable: " + e.getMessage());
        }
    }

    /**
     * Read buffered fixes captured while the WebView was dead. Read
     * only: the caller must call consumeBuffer after a confirmed
     * upload, so a failed upload never silently loses a drive.
     */
    @PluginMethod
    public void readBuffer(PluginCall call) {
        JSONArray fixes = TaxotticGeofenceStore.readBuffer(getContext());
        JSObject out = new JSObject();
        out.put("fixes", JSArray.from(toArray(fixes)));
        out.put("count", fixes.length());
        call.resolve(out);
    }

    private static Object[] toArray(JSONArray array) {
        Object[] out = new Object[array.length()];
        for (int i = 0; i < array.length(); i++) out[i] = array.opt(i);
        return out;
    }

    /** Drop the first N buffered fixes, after they have been uploaded. */
    @PluginMethod
    public void consumeBuffer(PluginCall call) {
        Integer count = call.getInt("count", 0);
        TaxotticGeofenceStore.consumeBuffer(getContext(), count == null ? 0 : count);
        JSObject out = new JSObject();
        out.put("remaining", TaxotticGeofenceStore.countBufferedFixes(getContext()));
        call.resolve(out);
    }

    /**
     * Hold the process at foreground-service importance for the duration of
     * a drive the WebView tracker is already watching.
     *
     * WHY THIS EXISTS, AND WHY stopCapture BELOW IS NOW NARROWER.
     *
     * stopCapture used to be called on every app launch, on the reasoning
     * that "two location foreground services at once is double battery for
     * one stream of points". The premise is false. The WebView watcher is
     * not a foreground service. It is a plain page in a process that, once
     * the screen goes off, sits at importance 400 (CACHED) with nothing
     * holding it up. So the handoff was not service-to-service; it was
     * protected-to-unprotected, performed at the exact moment a drive was
     * starting, and Android then reaped the survivor under memory pressure.
     *
     * Starting a foreground service from the background is restricted on
     * Android 12+. Two things make this callable anyway, and neither is
     * guaranteed for every user, so failure is recorded rather than assumed
     * away:
     *   - an app on the battery-optimisation allowlist is exempt from the
     *     background-start restriction
     *   - the geofence and Bluetooth paths carry their own exemptions
     * When neither applies the start throws, we record it, and we are no
     * worse off than before this method existed.
     */
    @PluginMethod
    public void startCapture(PluginCall call) {
        JSObject out = new JSObject();
        try {
            Intent intent = new Intent(getContext(), TaxotticResurrectionService.class);
            intent.putExtra(TaxotticResurrectionService.EXTRA_SOURCE,
                    TaxotticResurrectionService.SOURCE_DRIVE);
            ContextCompat.startForegroundService(getContext(), intent);
            out.put("started", true);
            out.put("reason", "started");
        } catch (Exception e) {
            // ForegroundServiceStartNotAllowedException on an Android 12+
            // device that is neither allowlisted nor acting on an exemption.
            // Real and expected on some hardware; the drive is still tracked
            // by the WebView exactly as it was before, just unprotected.
            Log.d(TAG, "startCapture: foreground start refused", e);
            out.put("started", false);
            out.put("reason", e.getClass().getSimpleName());
        }
        call.resolve(out);
    }

    /**
     * Stop a capture session because the drive is over.
     *
     * Called on drive end, NOT on app launch. Calling it at launch is what
     * tore down the process protection at the start of every resurrected
     * drive; see startCapture above.
     */
    @PluginMethod
    public void stopCapture(PluginCall call) {
        try {
            Intent intent = new Intent(getContext(), TaxotticResurrectionService.class);
            intent.setAction(TaxotticResurrectionService.ACTION_STOP);
            getContext().startService(intent);
        } catch (Exception e) {
            // Nothing running is the common case and is not an error.
            Log.d(TAG, "stopCapture: no resurrection service to stop", e);
        }
        call.resolve();
    }

    /** Forget every place and unregister the mesh. */
    @PluginMethod
    public void clearPlaces(PluginCall call) {
        TaxotticGeofenceStore.clearPlaces(getContext());
        String armState = TaxotticGeofenceRegistrar.reregister(getContext());
        JSObject out = new JSObject();
        out.put("armState", armState);
        call.resolve(out);
    }
}
