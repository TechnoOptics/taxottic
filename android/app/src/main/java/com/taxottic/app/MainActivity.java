package com.taxottic.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // AndroidManifest assigns AppTheme.NoActionBarLaunch (Theme.SplashScreen)
        // to this Activity for cold start. Swap in the real post-splash theme
        // here so the Activity runs with AppTheme.NoActionBar's window
        // background, bar colours and edge-to-edge opt-out rather than the
        // launch theme's. Note that setTheme MERGES (Resources.Theme.applyStyle
        // with force=true) rather than replaces, so anything the launch theme
        // sets and this one does not restate survives for the Activity's whole
        // life. That is why the launch theme sets no android:background: it used
        // to, and the value leaked into every view built from the Activity
        // context, including the ListView the Chromium <select> popup builds.
        // See https://developer.android.com/develop/ui/views/launch/splash-screen/migrate
        setTheme(R.style.AppTheme_NoActionBar);

        // Register the native bridges before the WebView bridge boots so
        // window.Capacitor exposes them: the Wear OS watch bridge and the
        // home-screen widget bridge.
        registerPlugin(TaxotticWatchBridgePlugin.class);
        registerPlugin(TaxotticWidgetBridgePlugin.class);
        registerPlugin(TaxotticDeviceStatusPlugin.class);
        // Learned-place geofence mesh. An unregistered plugin still
        // compiles and is simply absent at runtime, which this project
        // has already shipped once: TaxotticDeviceStatusPlugin was dead
        // for weeks because it was never wired up. Nothing here starts
        // tracking; the geofence receiver does that with no bridge at
        // all. This only lets the web layer push places down, read
        // health, and drain what was captured while it was dead.
        registerPlugin(TaxotticGeofencePlugin.class);
        // Car-connection signals (Bluetooth, Android Auto projection,
        // charging). Same warning as above and it matters differently
        // here: the manifest receivers record signals with no bridge at
        // all, so forgetting this line would not stop the signals, it
        // would only stop anything reading them. That failure looks like
        // silence rather than an error, which is the kind this codebase
        // has already shipped once.
        registerPlugin(TaxotticCarSignalsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
