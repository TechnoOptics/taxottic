package com.taxottic.app;

import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * JS → home-screen widget bridge.
 *
 *   update({ snapshot }) → persist the forecast snapshot JSON to a
 *   private SharedPreferences file and refresh every placed instance of
 *   TaxotticForecastWidget. The widget is a dumb renderer of that
 *   snapshot, so all plan/entity adaptation stays in the web app (the
 *   snapshot is already business- or personal-scoped by the server, or
 *   omits `forecast` entirely for a free/empty state).
 *
 * Java (the Capacitor app module is Java-only — no Kotlin toolchain on
 * the release build; mirrors TaxotticWatchBridgePlugin). Everything is
 * guarded so a malformed call can never crash the host app; the JS side
 * additionally gates on isPluginAvailable (the #69 graceful-degradation
 * lesson).
 */
@CapacitorPlugin(name = "TaxotticWidgetBridge")
public class TaxotticWidgetBridgePlugin extends Plugin {

    static final String PREFS = "taxottic_widget";
    static final String KEY_SNAPSHOT = "snapshot";
    static final String KEY_TS = "ts";

    /** JS → widget. Persist the snapshot and repaint the widget. */
    @PluginMethod
    public void update(PluginCall call) {
        JSObject snapshot = call.getObject("snapshot");
        if (snapshot == null) {
            call.reject("invalid snapshot");
            return;
        }
        try {
            Context ctx = getContext().getApplicationContext();
            SharedPreferences prefs =
                    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            prefs.edit()
                    .putString(KEY_SNAPSHOT, snapshot.toString())
                    .putLong(KEY_TS, System.currentTimeMillis())
                    .apply();
            TaxotticForecastWidget.refreshAll(ctx);
            call.resolve();
        } catch (Throwable t) {
            call.reject(t.getMessage());
        }
    }
}
